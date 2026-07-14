'use client';
import { useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DocumentSidebar } from '@/components/DocumentSidebar';

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
    // Day 2 仍是 mock；Day 3 接入真实 RAG + SSE
    setTimeout(() => {
      addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `📌 Day 2：知识库入库已经跑通了（试试左侧上传文档）。Day 3 会接入真实检索问答。`,
        status: 'done',
        createdAt: Date.now(),
      });
    }, 300);
    setInput('');
  }

  return (
    <div className="flex h-screen">
      <DocumentSidebar />

      <main className="flex-1 flex flex-col max-w-4xl mx-auto p-6">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">智能文档问答 Agent</h1>
          <p className="text-sm text-gray-500">
            RAG + LangGraph + Function Calling 全栈 Demo
          </p>
        </header>

        <div className="flex-1 overflow-y-auto space-y-4 mb-4 border rounded-lg p-4 bg-gray-50">
          {messages.length === 0 && (
            <p className="text-gray-400 text-center py-12">
              左侧上传文档，然后开始提问...
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`p-3 rounded-lg ${
                m.role === 'user' ? 'bg-blue-100 ml-8' : 'bg-white mr-8 border'
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
    </div>
  );
}
