'use client';
import { useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function Home() {
  const { messages, addMessage } = useChatStore();
  const [input, setInput] = useState('');

  function send() {
    if (!input.trim()) return;
    addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      status: 'done',
      createdAt: Date.now(),
    });
    // Day 1 mock 回复；Day 3 会替换为真实 SSE 流
    setTimeout(() => {
      addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `你说的是："${input}"（Day 1 mock 回复，Day 3 会接入真 LLM）`,
        status: 'done',
        createdAt: Date.now(),
      });
    }, 300);
    setInput('');
  }

  return (
    <main className="mx-auto max-w-3xl p-6 flex flex-col h-screen">
      <h1 className="text-2xl font-bold mb-1">智能文档问答 Agent</h1>
      <p className="text-sm text-gray-500 mb-4">
        RAG + LangGraph + Function Calling 全栈 Demo
      </p>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4 border rounded-lg p-4 bg-gray-50">
        {messages.length === 0 && (
          <p className="text-gray-400 text-center py-12">
            开始你的第一个提问...
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`p-3 rounded-lg ${
              m.role === 'user'
                ? 'bg-blue-100 ml-8'
                : 'bg-white mr-8 border'
            }`}
          >
            <div className="text-xs text-gray-500 mb-1">
              {m.role === 'user' ? '👤 你' : '🤖 Assistant'}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          className="resize-none"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button onClick={send}>发送</Button>
      </div>
    </main>
  );
}
