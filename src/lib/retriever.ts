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
 *   - 检索到的内容是 PDF 解析失败产物（unicode 转义）→ 过滤掉
 *   - 所有召回都不可用 → 返回空 chunks，提示 Stage 2 走 web_search
 */

import { llm } from './llm';
import { hybridSearch, type RetrievedChunk } from './rag';
import type { Citation } from '@/types/message';

export interface RetrievalResult {
  /** 优化后的查询词（LLM 改写后的结果，失败时等于原 query） */
  rewrittenQuery: string;
  /** 过滤后的文档片段（已剔除 PDF 解析失败产物） */
  chunks: RetrievedChunk[];
  /** 格式化的引用列表（供前端展示） */
  citations: Citation[];
  /** 格式化的上下文文本（供 Stage 2 Agent 作为输入） */
  context: string;
  /** 检索质量信号：是否有有效召回（false 时 Stage 2 应主动走 web_search） */
  hasValidContext: boolean;
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
 * 检测 PDF 解析失败产物：\u00000c/uni00000055/... 这种格式
 * 这些是 pdfjs 库在 ToUnicode CMap 缺失时输出的原始字符编码
 */
function isGarbageContent(text: string): boolean {
  if (!text || text.length < 50) return true;
  // 大量 uni 字符 + 大量 \u 转义 → PDF 解析失败
  const uniCount = (text.match(/uni\d{6}/g) ?? []).length;
  const escapeCount = (text.match(/\\u[0-9a-fA-F]{4}/g) ?? []).length;
  if (uniCount > 5 || escapeCount > 5) return true;
  // 几乎全部是非 ASCII 控制字符或奇怪字符
  const printable = text.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, '').length;
  if (printable / text.length < 0.3) return true;
  return false;
}

/**
 * 过滤掉垃圾内容
 */
function filterGarbage(chunks: RetrievedChunk[]): RetrievedChunk[] {
  return chunks.filter((c) => !isGarbageContent(c.content));
}

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
  if (!chunks.length) return '知识库中未检索到相关内容，建议使用 web_search 工具获取实时信息。';
  return chunks
    .map(
      (d, i) =>
        `[${i + 1}] (来源：${d.metadata?.source ?? '未知'})\n${d.content}`
    )
    .join('\n\n---\n\n');
}

/**
 * Stage 1 主入口：查询优化 + 混合检索 + Rerank + 垃圾过滤
 *
 * @param query 用户原始查询
 * @param topK 返回的文档片段数（默认 5）
 * @returns 结构化检索结果（包含 hasValidContext 信号）
 */
export async function retrieve(query: string, topK = 5): Promise<RetrievalResult> {
  // Step 1: LLM 查询优化
  const rewrittenQuery = await rewriteQuery(query);

  // Step 2: 混合检索 + Rerank（hybridSearch 内部已处理 Rerank 降级）
  // 多取一些候选（topK*3），过滤完可能不够
  const rawChunks = await hybridSearch(rewrittenQuery, Math.max(topK, 10));

  // Step 3: 过滤掉 PDF 解析失败产物（unicode 转义字符）
  const chunks = filterGarbage(rawChunks).slice(0, topK);
  const hasValidContext = chunks.length > 0;

  return {
    rewrittenQuery,
    chunks,
    citations: buildCitations(chunks),
    context: buildContext(chunks),
    hasValidContext,
  };
}
