/**
 * Hybrid Search 混合检索 + Reciprocal Rank Fusion 融合 + Rerank 精排
 *
 * 流程：
 *   1. 用户 query → 智谱 embedding → 向量检索 top-N（余弦相似度）
 *   2. 用户 query → BM25 全文检索 top-N（ts_rank）
 *   3. RRF 融合：score = 1 / (k + rank)，k=60
 *   4. Cohere Rerank 交叉编码器精排（可选，需 COHERE_API_KEY）
 *   5. 返回 top-K 段（默认 5）
 *
 * 解决"意思对但字面不匹配"的召回缺失（专有名词/代码/数字）。
 * Rerank 解决 RRF 只看排名不看内容的问题——交叉编码器直接评估 query-doc 相关性。
 */

import { embed } from './embedding';
import { supabase } from './supabase';
import { rerank } from './reranker';

export interface RetrievedChunk {
  id: number;
  content: string;
  metadata: {
    source?: string;
    chunk_index?: number;
    [key: string]: unknown;
  };
  similarity?: number;
  rank?: number;
}

/**
 * Reciprocal Rank Fusion
 * 输入：多路检索结果（各自按相关性降序）
 * 输出：融合排序后的候选列表
 */
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

/**
 * Hybrid Search 主入口。
 * @param query 用户查询
 * @param topK 最终返回段数
 * @param perRoute 每路召回段数（向量 / 关键词各自）
 * @param useRerank 是否使用 Cohere Rerank 精排（默认 true，无 key 时自动降级）
 */
export async function hybridSearch(
  query: string,
  topK = 5,
  perRoute = 10,
  useRerank = true
): Promise<RetrievedChunk[]> {
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

  // RRF 融合：取 topK*2 候选送入 Rerank（扩大候选池以提高精排效果）
  const rerankCandidates = rrf([vecDocs, kwDocs]).slice(0, topK * 2);

  if (useRerank) {
    return rerank(query, rerankCandidates, topK);
  }

  return rerankCandidates.slice(0, topK);
}
