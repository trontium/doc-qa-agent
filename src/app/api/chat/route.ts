import { NextRequest } from 'next/server';
import { hybridSearch } from '@/lib/rag';
import { streamChat, type ChatMessage } from '@/lib/deepseek';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * SSE 帧协议：
 *   data: {"type":"citations","citations":[{index,content,source}]}
 *   data: {"type":"content","chunk":"部分文本"}
 *   data: {"type":"error","error":"..."}
 *   data: [DONE]
 */
type SSEFrame =
  | { type: 'citations'; citations: Array<{ index: number; content: string; source?: string }> }
  | { type: 'content'; chunk: string }
  | { type: 'error'; error: string };

function encodeFrame(enc: TextEncoder, frame: SSEFrame): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(frame)}\n\n`);
}
function encodeDone(enc: TextEncoder): Uint8Array {
  return enc.encode('data: [DONE]\n\n');
}

const SYSTEM_TEMPLATE = (context: string) => `你是一位专业的文档问答助手。请严格基于下方"参考资料"回答用户问题。

# 参考资料
${context}

# 回答要求
- 若资料中没有答案，直接说"我在知识库中没有找到相关信息"，不要凭空编造。
- 引用资料时用 [1] [2] 这样的方括号标注对应段落编号。
- 回答简洁、准确，条理清晰，可以用 Markdown 排版（列表、代码块等）。`;

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const controller = new AbortController();

  // 客户端断开时，取消上游 DeepSeek 请求
  req.signal.addEventListener('abort', () => controller.abort());

  const stream = new ReadableStream({
    async start(streamCtrl) {
      const safeEnqueue = (frame: SSEFrame) => {
        try {
          streamCtrl.enqueue(encodeFrame(encoder, frame));
        } catch {
          /* stream 已关，忽略 */
        }
      };

      try {
        const body = await req.json();
        const messages: ChatMessage[] = body.messages ?? [];
        const userMsg = messages[messages.length - 1];
        if (!userMsg?.content) {
          safeEnqueue({ type: 'error', error: 'empty query' });
          streamCtrl.enqueue(encodeDone(encoder));
          streamCtrl.close();
          return;
        }

        // 1. Hybrid Search 检索 top-5
        const docs = await hybridSearch(userMsg.content, 5);
        const citations = docs.map((d, i) => ({
          index: i + 1,
          content: d.content,
          source: (d.metadata?.source as string) ?? undefined,
        }));

        // 2. 先把引用发给前端
        safeEnqueue({ type: 'citations', citations });

        // 3. 组装 Prompt，走 DeepSeek 流式
        const context = citations
          .map((c) => `[${c.index}] ${c.content}`)
          .join('\n\n');
        const chatMessages: ChatMessage[] = [
          { role: 'system', content: SYSTEM_TEMPLATE(context) },
          ...messages,
        ];

        for await (const chunk of streamChat({
          messages: chatMessages,
          signal: controller.signal,
        })) {
          safeEnqueue({ type: 'content', chunk });
        }

        streamCtrl.enqueue(encodeDone(encoder));
        streamCtrl.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 用户主动断开触发的 AbortError 不算错
        if (!(e instanceof Error && e.name === 'AbortError')) {
          safeEnqueue({ type: 'error', error: msg });
        }
        streamCtrl.enqueue(encodeDone(encoder));
        streamCtrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
