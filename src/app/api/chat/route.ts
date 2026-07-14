/**
 * POST /api/chat · LangGraph Agent SSE 流式接口
 *
 * SSE 帧协议：
 *   data: {"type":"tool_call","name":"retrieve_docs","status":"running"}
 *   data: {"type":"tool_call","name":"retrieve_docs","status":"done"}
 *   data: {"type":"citations","citations":[...]}         // retrieve_docs 结束时补发
 *   data: {"type":"content","chunk":"回答..."}
 *   data: {"type":"error","error":"..."}
 *   data: [DONE]
 */

import type { NextRequest } from 'next/server';
import { HumanMessage, AIMessageChunk } from '@langchain/core/messages';
import { agent } from '@/lib/agent';
import { hybridSearch } from '@/lib/rag';
import type { Citation } from '@/types/message';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatPayload {
  messages: { role: 'user' | 'assistant'; content: string }[];
  threadId?: string;
}

export async function POST(req: NextRequest) {
  let payload: ChatPayload;
  try {
    payload = (await req.json()) as ChatPayload;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const { messages, threadId = 'default' } = payload;
  const lastUser = messages[messages.length - 1];
  if (!lastUser || lastUser.role !== 'user') {
    return Response.json({ error: 'last message must be user' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const send = (
    ctrl: ReadableStreamDefaultController<Uint8Array>,
    payload: Record<string, unknown>
  ) => ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  const stream = new ReadableStream({
    async start(ctrl) {
      const abort = new AbortController();
      req.signal.addEventListener('abort', () => abort.abort());

      try {
        const events = agent.streamEvents(
          { messages: [new HumanMessage(lastUser.content)] },
          {
            configurable: { thread_id: threadId },
            version: 'v2',
            signal: abort.signal,
            recursionLimit: 10,
          }
        );

        for await (const evt of events) {
          // 工具调用开始
          if (evt.event === 'on_tool_start') {
            send(ctrl, {
              type: 'tool_call',
              name: evt.name,
              status: 'running',
            });
          }
          // 工具调用结束
          if (evt.event === 'on_tool_end') {
            send(ctrl, {
              type: 'tool_call',
              name: evt.name,
              status: 'done',
            });
            // retrieve_docs 结束后，补发一次 citations（前端拿来渲染引用卡片）
            if (evt.name === 'retrieve_docs') {
              try {
                const query =
                  (evt.data?.input as { query?: string } | undefined)?.query ??
                  lastUser.content;
                const docs = await hybridSearch(query, 5);
                const citations: Citation[] = docs.map((d, i) => ({
                  index: i + 1,
                  content: d.content,
                  source:
                    (d.metadata as { source?: string } | null)?.source ?? '未知',
                }));
                send(ctrl, { type: 'citations', citations });
              } catch {
                /* 补发失败不影响主流 */
              }
            }
          }
          // LLM 生成 token
          if (evt.event === 'on_chat_model_stream') {
            const chunk = evt.data?.chunk as AIMessageChunk | undefined;
            const text = chunk?.content;
            if (typeof text === 'string' && text) {
              send(ctrl, { type: 'content', chunk: text });
            } else if (Array.isArray(text)) {
              // content array（工具调用时可能是 [] 或 [{type:'text',text:'...'}]）
              for (const part of text) {
                if (
                  typeof part === 'object' &&
                  part &&
                  'type' in part &&
                  part.type === 'text' &&
                  'text' in part &&
                  typeof part.text === 'string'
                ) {
                  send(ctrl, { type: 'content', chunk: part.text });
                }
              }
            }
          }
        }

        ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (e) {
        send(ctrl, { type: 'error', error: (e as Error).message });
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
