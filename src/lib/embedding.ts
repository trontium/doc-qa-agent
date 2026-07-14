/**
 * 智谱 GLM Embedding-3 客户端。
 * - 模型：embedding-3
 * - 维度：固定 1024（与 documents.embedding 字段对齐）
 * - 端点：https://open.bigmodel.cn/api/paas/v4/embeddings
 * - 认证：Bearer <ZHIPU_API_KEY>
 */

const ZHIPU_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/embeddings';
export const EMBED_DIMENSIONS = 1024;

type ZhipuEmbedResponse = {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
};

/**
 * 单条文本转 1024 维向量。
 */
export async function embed(text: string): Promise<number[]> {
  const vectors = await embedMany([text]);
  return vectors[0];
}

/**
 * 批量文本转向量。智谱 embedding-3 支持数组 input。
 * 一次最多 64 条（智谱限制），超过自动分批。
 */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (!process.env.ZHIPU_API_KEY) {
    throw new Error('ZHIPU_API_KEY 未设置');
  }

  const BATCH = 64;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch(ZHIPU_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.ZHIPU_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'embedding-3',
        input: batch,
        dimensions: EMBED_DIMENSIONS,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Zhipu embed failed ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as ZhipuEmbedResponse;
    // 智谱按 index 返回，需按 index 排序保证与输入顺序一致
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      results.push(item.embedding);
    }
  }

  return results;
}
