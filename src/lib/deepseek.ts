/**
 * DeepSeek Chat 客户端。
 * - 模型：deepseek-chat（对齐 GPT-4o-mini 价位）
 * - 端点：https://api.deepseek.com/chat/completions（兼容 OpenAI API 格式）
 * - 认证：Bearer <DEEPSEEK_API_KEY>
 */

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export interface StreamChatParams {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * SSE 流式请求 DeepSeek，返回 AsyncIterable<string> 逐 token 输出。
 */
export async function* streamChat({
  messages,
  model = 'deepseek-chat',
  temperature = 0.3,
  signal,
}: StreamChatParams): AsyncGenerator<string, void, unknown> {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY 未设置');
  }

  const res = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按 SSE 行边界解析
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (typeof content === 'string' && content.length > 0) {
            yield content;
          }
        } catch {
          // 忽略解析失败的心跳/空行
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}
