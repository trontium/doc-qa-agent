/**
 * POST /api/chat · LangGraph Agent SSE 流式接口
 *
 * SSE 帧协议：
 *   data: {"type":"tool_call","name":"retrieve_docs","status":"running","input":"...","startedAt":...}
 *   data: {"type":"tool_call","name":"retrieve_docs","status":"done","output":"...","duration":...}
 *   data: {"type":"citations","citations":[...]}         // retrieve_docs 结束时补发
 *   data: {"type":"content","chunk":"回答..."}
 *   data: {"type":"error","error":"..."}
 *   data: [DONE]
 */

import type { NextRequest } from 'next/server';
import { HumanMessage, AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { agent, getAgent } from '@/lib/agent';
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
  if (!messages.length) {
    return Response.json({ error: 'messages cannot be empty' }, { status: 400 });
  }
  const lastUser = messages[messages.length - 1];
  if (lastUser.role !== 'user') {
    return Response.json({ error: 'last message must be user' }, { status: 400 });
  }

  // 将前端 messages 全部转为 LangChain Message 格式（支持多轮上下文）
  const langchainMessages = messages.map((m) =>
    m.role === 'user'
      ? new HumanMessage(m.content)
      : new AIMessage(m.content)
  );

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
        // 获取 agent（MCP 模式时从 MCP Server 动态发现工具，否则用硬编码工具）
        const activeAgent = await getAgent();
        const events = activeAgent.streamEvents(
          { messages: langchainMessages },
          {
            configurable: { thread_id: threadId },
            version: 'v2',
            signal: abort.signal,
            recursionLimit: 10,
          }
        );

        // 跟踪工具调用开始时间，用于计算耗时
        const toolStartTimes = new Map<string, number>();

        for await (const evt of events) {
          // 工具调用开始——透传输入参数
          if (evt.event === 'on_tool_start') {
            const startedAt = Date.now();
            toolStartTimes.set(evt.name, startedAt);
            const input = evt.data?.input;
            send(ctrl, {
              type: 'tool_call',
              name: evt.name,
              status: 'running',
              input: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
              startedAt,
            });
          }
          // 工具调用结束——透传输出结果 + 耗时
          if (evt.event === 'on_tool_end') {
            const startTime = toolStartTimes.get(evt.name);
            const duration = startTime ? Date.now() - startTime : undefined;
            toolStartTimes.delete(evt.name);
            const output = evt.data?.output;
            send(ctrl, {
              type: 'tool_call',
              name: evt.name,
              status: 'done',
              output: typeof output === 'string'
                ? output.length > 500 ? output.slice(0, 500) + '…' : output
                : JSON.stringify(output ?? {}).slice(0, 500),
              duration,
            });
            // retrieve_docs 结束后，从工具输出中提取 citations（不再二次检索）
            if (evt.name === 'retrieve_docs') {
              try {
                const output = typeof evt.data?.output === 'string'
                  ? evt.data.output
                  : String(evt.data?.output ?? '');
                // 工具输出格式：[1] (来源：xxx)\n内容\n\n---\n\n[2] (来源：yyy)\n内容
                const citations: Citation[] = [];
                const regex = /\[(\d+)\]\s*\(来源：([^)]*)\)\n([\s\S]*?)(?=\n\n---\n\n|\s*$)/g;
                let match;
                while ((match = regex.exec(output)) !== null) {
                  citations.push({
                    index: Number(match[1]),
                    content: match[3].trim(),
                    source: match[2] || '未知',
                  });
                }
                if (citations.length) {
                  send(ctrl, { type: 'citations', citations });
                }
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
