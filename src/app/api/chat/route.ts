/**
 * POST /api/chat · 2-Stage Pipeline SSE 流式接口
 *
 * SSE 帧协议：
 *   data: {"type":"stage","stage":"retrieving"|"generating"}
 *   data: {"type":"tool_call","name":"query_rewrite","status":"running","startedAt":...}
 *   data: {"type":"tool_call","name":"query_rewrite","status":"done","output":"...","duration":...}
 *   data: {"type":"tool_call","name":"retrieve_docs","status":"running","startedAt":...}
 *   data: {"type":"tool_call","name":"retrieve_docs","status":"done","output":"...","duration":...}
 *   data: {"type":"citations","citations":[...]}
 *   data: {"type":"tool_call","name":"xxx","status":"running",...}  (Stage 2 agent tools)
 *   data: {"type":"tool_call","name":"xxx","status":"done",...}
 *   data: {"type":"content","chunk":"回答..."}
 *   data: {"type":"error","error":"..."}
 *   data: [DONE]
 */

import type { NextRequest } from 'next/server';
import { HumanMessage, AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { agent, getAgent, getPipelineGenerator } from '@/lib/agent';
import { retrieve } from '@/lib/retriever';
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

  const encoder = new TextEncoder();
  const send = (
    ctrl: ReadableStreamDefaultController<Uint8Array>,
    payload: Record<string, unknown>
  ) => ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  const usePipeline = process.env.ENABLE_PIPELINE !== 'false'; // 默认开启

  const stream = new ReadableStream({
    async start(ctrl) {
      const abort = new AbortController();
      req.signal.addEventListener('abort', () => abort.abort());

      try {
        if (usePipeline) {
          await handlePipeline(ctrl, send, messages, threadId, abort.signal);
        } else {
          await handleSingleAgent(ctrl, send, messages, threadId, abort.signal);
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

// ==================== 2-Stage Pipeline ====================

async function handlePipeline(
  ctrl: ReadableStreamDefaultController<Uint8Array>,
  send: (ctrl: ReadableStreamDefaultController<Uint8Array>, payload: Record<string, unknown>) => void,
  messages: { role: 'user' | 'assistant'; content: string }[],
  threadId: string,
  signal: AbortSignal
) {
  const userQuery = messages[messages.length - 1].content;

  // ---- Stage 1: Retrieval ----
  send(ctrl, { type: 'stage', stage: 'retrieving' });

  // 查询改写
  const rewriteStart = Date.now();
  send(ctrl, {
    type: 'tool_call',
    name: 'query_rewrite',
    status: 'running',
    startedAt: rewriteStart,
  });

  const result = await retrieve(userQuery);

  const rewriteDuration = Date.now() - rewriteStart;
  send(ctrl, {
    type: 'tool_call',
    name: 'query_rewrite',
    status: 'done',
    output: result.rewrittenQuery,
    duration: rewriteDuration,
  });

  // 检索（retrieve 内部已完成，这里只发事件）
  const retrieveStart = Date.now();
  send(ctrl, {
    type: 'tool_call',
    name: 'retrieve_docs',
    status: 'running',
    input: result.rewrittenQuery,
    startedAt: retrieveStart,
  });

  const retrieveDuration = Date.now() - retrieveStart;
  // 构建简短 output（不要发完整文档内容，太长）
  const outputSummary = result.chunks.length > 0
    ? `检索到 ${result.chunks.length} 个相关片段`
    : '知识库中未检索到相关内容';
  send(ctrl, {
    type: 'tool_call',
    name: 'retrieve_docs',
    status: 'done',
    output: outputSummary,
    duration: retrieveDuration,
  });

  // 发送 citations
  if (result.citations.length > 0) {
    send(ctrl, { type: 'citations', citations: result.citations });
  }

  // ---- Stage 2: Generation ----
  send(ctrl, { type: 'stage', stage: 'generating' });

  const pipelineAgent = getPipelineGenerator();

  // 构造 Stage 2 输入：历史对话 + 检索上下文作为最新 HumanMessage
  const historyMessages = messages.slice(0, -1).map((m) =>
    m.role === 'user'
      ? new HumanMessage(m.content)
      : new AIMessage(m.content)
  );

  const contextMessage = new HumanMessage(
    `${result.hasValidContext
      ? `基于以下检索结果回答问题：\n\n${result.context}`
      : `⚠️ 检索阶段未从知识库中找到有效内容（可能是不相关问题、或知识库内容是 PDF 解析失败产物）。\n请主动判断：\n- 如果是实时信息（新闻、年份、汇率等），调用 web_search\n- 如果是数学计算，调用 calculator\n- 否则直接回答用户`
    }\n\n用户问题：${userQuery}`
  );

  const langchainMessages = [...historyMessages, contextMessage];

  const events = pipelineAgent.streamEvents(
    { messages: langchainMessages },
    {
      configurable: { thread_id: threadId },
      version: 'v2',
      signal,
      recursionLimit: 10,
    }
  );

  const toolStartTimes = new Map<string, number>();

  for await (const evt of events) {
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
    }
    if (evt.event === 'on_chat_model_stream') {
      const chunk = evt.data?.chunk as AIMessageChunk | undefined;
      const text = chunk?.content;
      if (typeof text === 'string' && text) {
        send(ctrl, { type: 'content', chunk: text });
      } else if (Array.isArray(text)) {
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
}

// ==================== 单 Agent 模式（降级 / MCP）====================

async function handleSingleAgent(
  ctrl: ReadableStreamDefaultController<Uint8Array>,
  send: (ctrl: ReadableStreamDefaultController<Uint8Array>, payload: Record<string, unknown>) => void,
  messages: { role: 'user' | 'assistant'; content: string }[],
  threadId: string,
  signal: AbortSignal
) {
  const langchainMessages = messages.map((m) =>
    m.role === 'user'
      ? new HumanMessage(m.content)
      : new AIMessage(m.content)
  );

  const activeAgent = await getAgent();
  const events = activeAgent.streamEvents(
    { messages: langchainMessages },
    {
      configurable: { thread_id: threadId },
      version: 'v2',
      signal,
      recursionLimit: 10,
    }
  );

  const toolStartTimes = new Map<string, number>();

  for await (const evt of events) {
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
      // 单 Agent 模式下 retrieve_docs 仍需提取 citations
      if (evt.name === 'retrieve_docs') {
        try {
          const raw = typeof evt.data?.output === 'string'
            ? evt.data.output
            : String(evt.data?.output ?? '');
          const citations: Citation[] = [];
          const regex = /\[(\d+)\]\s*\(来源：([^)]*)\)\n([\s\S]*?)(?=\n\n---\n\n|\s*$)/g;
          let match;
          while ((match = regex.exec(raw)) !== null) {
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
    if (evt.event === 'on_chat_model_stream') {
      const chunk = evt.data?.chunk as AIMessageChunk | undefined;
      const text = chunk?.content;
      if (typeof text === 'string' && text) {
        send(ctrl, { type: 'content', chunk: text });
      } else if (Array.isArray(text)) {
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
}
