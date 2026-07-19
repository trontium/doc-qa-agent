/**
 * Cohere Rerank 交叉编码器精排
 *
 * 流程：Hybrid Search + RRF 融合后的 top-K 候选 → Cohere Rerank 精排 → 返回最相关的 top-N
 *
 * 为什么需要精排：
 *   RRF 只基于排名融合（第1名得 1/(k+1)），不知道文档内容跟 query 到底有多相关。
 *   交叉编码器把 query 和每个文档拼在一起输入模型，直接输出相关性分数，
 *   可以捕捉 query-document 之间的细粒度语义交互。
 *   但交叉编码器更慢更贵，所以只对 RRF 的 top-K 结果做精排，不是全量重排。
 *
 * API: Cohere Rerank v2 (POST https://api.cohere.com/v2/rerank)
 * 模型: rerank-v3.5 (多语言支持，中文友好)
 * 免费额度: 1000 次/月
 */

import type { RetrievedChunk } from './rag';

interface RerankResult {
  index: number;
  relevance_score: number;
}

interface RerankResponse {
  results: RerankResult[];
}

/**
 * 对 RRF 融合后的候选文档做交叉编码器精排
 * @param query 用户查询
 * @param candidates RRF 融合后的候选文档
 * @param topN 精排后返回的文档数（默认与输入相同）
 * @returns 按相关性降序排列的文档
 */
export async function rerank(
  query: string,
  candidates: RetrievedChunk[],
  topN?: number
): Promise<RetrievedChunk[]> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    // Rerank 是增强层，没有 API key 时降级为直接返回 RRF 结果
    console.warn('[rerank] COHERE_API_KEY not set, skipping rerank');
    return topN ? candidates.slice(0, topN) : candidates;
  }

  if (!candidates.length) return [];

  const documents = candidates.map((c) => c.content);
  const body: Record<string, unknown> = {
    model: 'rerank-v3.5',
    query,
    documents,
  };
  if (topN) body.top_n = topN;

  const res = await fetch('https://api.cohere.com/v2/rerank', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[rerank] Cohere API ${res.status}: ${errText}`);
    // 降级：API 异常时返回原 RRF 结果
    return topN ? candidates.slice(0, topN) : candidates;
  }

  const data = (await res.json()) as RerankResponse;
  // results 按 relevance_score 降序，index 对应 candidates 的下标
  return data.results.map((r) => ({
    ...candidates[r.index],
    // 用交叉编码器的相关性分数替换 RRF 分数
    similarity: r.relevance_score,
  }));
}
