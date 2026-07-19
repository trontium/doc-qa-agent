'use client';
import { useCallback, useRef, useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import type { Message, Citation, ToolCall } from '@/types/message';

/**
 * useChat · Day 3 版本
 *
 * 核心：
 * - 5 态状态机：idle / streaming / done / error / aborted
 * - AbortController 中断
 * - buffer 拼接防跨 chunk 中文乱码（TextDecoder({stream:true})）
 * - 简单的 raf 批量 flush（避免每 chunk setState → diff 风暴）
 */
export function useChat() {
  const store = useChatStore;
  const [status, setStatus] = useState<'idle' | 'streaming'>('idle');
  const ctrlRef = useRef<AbortController | null>(null);

  // rAF 批量 flush
  const pendingRef = useRef<string>('');
  const rafRef = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (pendingRef.current) {
      const inc = pendingRef.current;
      pendingRef.current = '';
      store.getState().updateLast({
        content: (store.getState().messages.at(-1)?.content ?? '') + inc,
      });
    }
    rafRef.current = null;
  }, [store]);
  const pushChunk = useCallback(
    (chunk: string) => {
      pendingRef.current += chunk;
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [flush]
  );

  const send = useCallback(
    async (input: string) => {
      const text = input.trim();
      if (!text) return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        status: 'done',
        createdAt: Date.now(),
      };
      const asstMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        status: 'streaming',
        createdAt: Date.now(),
      };

      store.getState().addMessage(userMsg);
      store.getState().addMessage(asstMsg);
      setStatus('streaming');

      const ctrl = new AbortController();
      ctrlRef.current = ctrl;

      // 组装请求（把已有消息作为多轮上下文）
      const history = store
        .getState()
        .messages.filter((m) => m.role === 'user' || m.role === 'assistant')
        .filter((m) => m.status === 'done' || m.id === userMsg.id)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const raw of lines) {
            const line = raw.trim();
            if (!line || !line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;

            try {
              const evt = JSON.parse(data) as
                | { type: 'citations'; citations: Citation[] }
                | { type: 'content'; chunk: string }
                | { type: 'tool_call'; name: string; status: 'running' | 'done'; input?: string; output?: string; duration?: number; startedAt?: number }
                | { type: 'error'; error: string };

              if (evt.type === 'citations') {
                store.getState().updateLast({ citations: evt.citations });
              } else if (evt.type === 'content') {
                pushChunk(evt.chunk);
              } else if (evt.type === 'tool_call') {
                const cur = store.getState().messages.at(-1);
                const prev: ToolCall[] = cur?.toolCalls ?? [];
                const idx = prev.findIndex((t) => t.name === evt.name);
                const existing = idx >= 0 ? prev[idx] : undefined;
                const updated: ToolCall = {
                  name: evt.name,
                  status: evt.status,
                  // running 时记录 input 和 startedAt，done 时记录 output 和 duration
                  ...(evt.status === 'running'
                    ? { input: evt.input, startedAt: evt.startedAt }
                    : {}),
                  ...(evt.status === 'done'
                    ? { output: evt.output, duration: evt.duration }
                    : {}),
                  // 保留之前的字段（running 时已记录的 input/startedAt）
                  ...(existing ? { input: existing.input, startedAt: existing.startedAt } : {}),
                };
                const next: ToolCall[] =
                  idx >= 0
                    ? prev.map((t, i) => (i === idx ? updated : t))
                    : [...prev, updated];
                store.getState().updateLast({ toolCalls: next });
              } else if (evt.type === 'error') {
                store.getState().updateLast({
                  status: 'error',
                  content:
                    (store.getState().messages.at(-1)?.content ?? '') +
                    `\n\n[出错：${evt.error}]`,
                });
              }
            } catch {
              /* 忽略非 JSON */
            }
          }
        }

        // 最后 flush 一下剩余 buffer
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        flush();

        // 只有还是 streaming 才置为 done（可能已被 error 分支改过）
        const last = store.getState().messages.at(-1);
        if (last?.status === 'streaming') {
          store.getState().updateLast({ status: 'done' });
        }
      } catch (e) {
        const aborted = e instanceof Error && e.name === 'AbortError';
        // flush 剩余，再打状态
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        flush();
        store.getState().updateLast({
          status: aborted ? 'aborted' : 'error',
        });
      } finally {
        setStatus('idle');
        ctrlRef.current = null;
      }
    },
    [store, pushChunk, flush]
  );

  const stop = useCallback(() => {
    ctrlRef.current?.abort();
  }, []);

  return { status, send, stop };
}
