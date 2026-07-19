/**
 * 检索管道评估脚本
 *
 * 比较三种检索策略在 Top-3 / Top-5 命中率上的表现：
 *   1. 纯向量检索（pgvector HNSW 余弦相似度）
 *   2. 混合检索 + RRF 融合（向量 + BM25 + RRF）
 *   3. 混合检索 + RRF + Cohere Rerank 精排
 *
 * 运行方式：npx tsx -r dotenv/config scripts/eval.ts
 *
 * 前置条件：
 *   - .env.local 已配置 ZHIPU_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   - 数据库中已有文档数据
 *   - COHERE_API_KEY（可选，无则跳过 Rerank 评估）
 *
 * 注意：必须使用 -r dotenv/config 预加载环境变量，
 *       因为 supabase.ts 在模块级初始化时就需要 SUPABASE_URL。
 */

import { config } from 'dotenv';
// dotenv/config 通过 -r 参数预加载，这里额外加载 .env.local
config({ path: '.env.local' });

import { readFileSync } from 'fs';
import { join } from 'path';
import { supabase } from '../src/lib/supabase';
import { embed } from '../src/lib/embedding';
import { rerank } from '../src/lib/reranker';
import type { RetrievedChunk } from '../src/lib/rag';

// ---- 评估查询集 ----
interface EvalQuery {
  id: number;
  query: string;
  category: string;
  ground_truth_keywords: string[];
}

const queries: EvalQuery[] = JSON.parse(
  readFileSync(join(__dirname, 'eval-queries.json'), 'utf-8')
);

// ---- RRF 融合 ----
function rrf(lists: RetrievedChunk[][], k = 60): RetrievedChunk[] {
  const scoreMap = new Map<number, { doc: RetrievedChunk; score: number }>();
  for (const list of lists) {
    list.forEach((doc, idx) => {
      const s = 1 / (k + idx + 1);
      const prev = scoreMap.get(doc.id);
      if (prev) {
        prev.score += s;
      } else {
        scoreMap.set(doc.id, { doc, score: s });
      }
    });
  }
  return [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .map((x) => x.doc);
}

// ---- 三种检索策略 ----

// 策略 1：纯向量检索
async function vectorOnly(query: string, topK: number): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embed(query);
  const res = await supabase.rpc('match_docs', {
    query_embedding: queryEmbedding,
    match_count: topK,
  });
  return (res.data ?? []) as RetrievedChunk[];
}

// 策略 2：混合检索 + RRF
async function hybridRRF(query: string, topK: number, perRoute = 10): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embed(query);
  const [vecRes, kwRes] = await Promise.all([
    supabase.rpc('match_docs', {
      query_embedding: queryEmbedding,
      match_count: perRoute,
    }),
    supabase.rpc('keyword_docs', {
      query,
      match_count: perRoute,
    }),
  ]);
  const vecDocs = (vecRes.data ?? []) as RetrievedChunk[];
  const kwDocs = (kwRes.data ?? []) as RetrievedChunk[];
  return rrf([vecDocs, kwDocs]).slice(0, topK);
}

// 策略 3：混合检索 + RRF + Rerank
async function hybridRRFRerank(query: string, topK: number, perRoute = 10): Promise<RetrievedChunk[]> {
  const candidates = await hybridRRF(query, topK * 2, perRoute);
  return rerank(query, candidates, topK);
}

// ---- 命中率评估 ----

/**
 * 判断一个检索结果是否命中 ground truth
 * 标准：检索结果的 content 中包含 ground_truth_keywords 中的至少一个关键词
 */
function isHit(doc: RetrievedChunk, keywords: string[]): boolean {
  const content = doc.content.toLowerCase();
  return keywords.some((kw) => content.includes(kw.toLowerCase()));
}

/**
 * 计算 Top-K 命中率
 * 命中 = Top-K 结果中至少有一个包含 ground truth 关键词
 */
function topKHitRate(
  results: RetrievedChunk[][],
  groundTruths: string[][],
  k: number
): number {
  let hits = 0;
  for (let i = 0; i < results.length; i++) {
    const topK = results[i].slice(0, k);
    if (topK.some((doc) => isHit(doc, groundTruths[i]))) {
      hits++;
    }
  }
  return hits / results.length;
}

/**
 * 计算 MRR（Mean Reciprocal Rank）
 * 第一个命中结果的排名倒数，衡量排序质量
 * MRR=1.0 意味着每次第一个结果就命中，MRR=0.5 意味着平均第二个命中
 */
function meanReciprocalRank(
  results: RetrievedChunk[][],
  groundTruths: string[][]
): number {
  let sum = 0;
  for (let i = 0; i < results.length; i++) {
    const rank = results[i].findIndex((doc) => isHit(doc, groundTruths[i]));
    sum += rank >= 0 ? 1 / (rank + 1) : 0;
  }
  return sum / results.length;
}

// ---- 主流程 ----
async function main() {
  console.log('=== 检索管道评估 ===\n');
  console.log(`评估集：${queries.length} 条查询\n`);

  const topKs = [3, 5];
  const strategies = [
    { name: '纯向量检索', fn: vectorOnly },
    { name: '混合检索 + RRF', fn: hybridRRF },
    { name: '混合检索 + RRF + Rerank', fn: hybridRRFRerank },
  ];

  for (const strategy of strategies) {
    console.log(`\n--- ${strategy.name} ---`);
    const allResults: RetrievedChunk[][] = [];
    const allGroundTruths: string[][] = [];

    for (const q of queries) {
      try {
        const results = await strategy.fn(q.query, 10);
        allResults.push(results);
        allGroundTruths.push(q.ground_truth_keywords);
        const top3Hit = results.slice(0, 3).some((d) => isHit(d, q.ground_truth_keywords));
        console.log(`  Q${q.id} [${q.category}] "${q.query}" → Top-3 ${top3Hit ? '✅' : '❌'}`);
      } catch (e) {
        console.error(`  Q${q.id} 出错: ${(e as Error).message}`);
        allResults.push([]);
        allGroundTruths.push(q.ground_truth_keywords);
      }
    }

    console.log('\n  汇总：');
    for (const k of topKs) {
      const rate = topKHitRate(allResults, allGroundTruths, k);
      console.log(`  Top-${k} 命中率: ${(rate * 100).toFixed(1)}%`);
    }
    const mrr = meanReciprocalRank(allResults, allGroundTruths);
    console.log(`  MRR (排序质量): ${mrr.toFixed(3)}`);
  }

  console.log('\n=== 评估完成 ===');
}

main().catch(console.error);
