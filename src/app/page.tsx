'use client';
import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useChat } from '@/hooks/useChat';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DocumentSidebar } from '@/components/DocumentSidebar';
import { ChatMessage } from '@/components/ChatMessage';
import { Square, Send } from 'lucide-react';

export default function Home() {
  const messages = useChatStore((s) => s.messages);
  const clear = useChatStore((s) => s.clear);
  const { status, send, stop } = useChat();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);

  // 用户上滑时暂停自动滚到底（宝典 §9.2 · 尊重用户）
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      autoScrollRef.current = nearBottom;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // 消息更新时若用户在底部则跟随滚动
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  function submit() {
    if (!input.trim() || status === 'streaming') return;
    const q = input;
    setInput('');
    autoScrollRef.current = true;
    send(q);
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <DocumentSidebar />

      <main className="flex-1 flex flex-col max-w-4xl mx-auto p-6 min-w-0">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">智能文档问答 Agent</h1>
            <p className="text-sm text-gray-500">
              RAG + Hybrid Search + SSE 流式 · Day 3
            </p>
          </div>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={clear}>
              清空会话
            </Button>
          )}
        </header>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto space-y-4 mb-4 border rounded-lg p-4 bg-white"
        >
          {messages.length === 0 && (
            <div className="text-center py-16 text-gray-400 space-y-2">
              <div className="text-4xl">📚 🤖</div>
              <p>左侧上传文档后，就可以针对它们提问</p>
              <p className="text-xs">
                示例：&ldquo;这份文档讲了什么？&rdquo; · &ldquo;总结主要观点&rdquo;
              </p>
            </div>
          )}
          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入问题，Enter 发送 · Shift+Enter 换行"
            className="resize-none min-h-[64px]"
            rows={2}
            disabled={status === 'streaming'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {status === 'streaming' ? (
            <Button variant="destructive" onClick={stop} className="h-16">
              <Square className="w-4 h-4 mr-1" />
              停止
            </Button>
          ) : (
            <Button onClick={submit} disabled={!input.trim()} className="h-16">
              <Send className="w-4 h-4" />
              <span className="ml-1">发送</span>
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
