/**
 * 2-Stage Pipeline · Stage 1: Retrieval — 查询优化 + 混合检索 + Rerank 精排
 *
 * 为什么需要 Stage 1：
 *   - 用户原始 query 可能口语化、模糊、包含歧义词，直接检索召回质量差
 *   - LLM 查询优化把口语化 query 转为更精确的检索词
 *   - hybridSearch + rerank 保证召回质量
 *   - Stage 2（Agent）拿到结构化上下文后只负责组织回答，不需要再决策"要不要检索"
 *
 * 降级策略：
 *   - LLM 查询优化失败 → 用原 query 检索（不影响主流程）
 *   - Rerank 不可用 → hybridSearch 内部已处理降级
 */

import { llm } from './llm';
import { hybridSearch, type RetrievedChunk } from './rag';
import type { Citation } from '@/types/message';

export interface RetrievalResult {
  /** 优化后的查询词（LLM 改写后的结果，失败时等于原 query） */
  rewrittenQuery: string;
  /** 检索到的文档片段 */
  chunks: RetrievedChunk[];
  /** 格式化的引用列表（供前端展示） */
  citations: Citation[];
  /** 格式化的上下文文本（供 Stage 2 Agent 作为输入） */
  context: string;
}

const REWRITE_PROMPT = `你是一个查询优化助手。用户的原始查询可能口语化、模糊或包含歧义。
请将用户的查询改写为更适合文档检索的关键词形式。

要求：
- 保留核心语义，去除口语化表达
- 补充可能缺失的专业术语
- 如果原查询已经足够精确，直接返回原查询
- 只输出改写后的查询，不要输出任何解释

原始查询：{query}

改写后的查询：`;

/**
 * LLM 查询优化
 * 失败时降级返回原 query
 */
async function rewriteQuery(query: string): Promise<string> {
  try {
    const response = await llm.invoke([
      { role: 'user', content: REWRITE_PROMPT.replace('{query}', query) },
    ]);
    const rewritten = response.content?.toString().trim() ?? query;
    // 防止 LLM 输出空字符串或过长内容
    if (!rewritten || rewritten.length > 200) return query;
    return rewritten;
  } catch (e) {
    console.warn('[retriever] Query rewrite failed, using original query:', (e as Error).message);
    return query;
  }
}

/**
 * 从检索结果生成引用列表
 */
function buildCitations(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((chunk, i) => ({
    index: i + 1,
    content: chunk.content,
    source: chunk.metadata?.source ?? '未知',
  }));
}

/**
 * 从检索结果生成格式化上下文（供 Stage 2 Agent 读取）
 * 格式与 retrieveDocs 工具输出一致，保证兼容性
 */
function buildContext(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return '知识库中未检索到相关内容。';
  return chunks
    .map(
      (d, i) =>
        `[${i + 1}] (来源：${d.metadata?.source ?? '未知'})\n${d.content}`
    )
    .join('\n\n---\n\n');
}

/**
 * Stage 1 主入口：查询优化 + 混合检索 + Rerank
 *
 * @param query 用户原始查询
 * @param topK 返回的文档片段数（默认 5）
 * @returns 结构化检索结果
 */
export async function retrieve(query: string, topK = 5): Promise<RetrievalResult> {
  // Step 1: LLM 查询优化
  const rewrittenQuery = await rewriteQuery(query);

  // Step 2: 混合检索 + Rerank（hybridSearch 内部已处理 Rerank 降级）
  const chunks = await hybridSearch(rewrittenQuery, topK);

  // Step 3: 构建结构化输出
  return {
    rewrittenQuery,
    chunks,
    citations: buildCitations(chunks),
    context: buildContext(chunks),
  };
}
