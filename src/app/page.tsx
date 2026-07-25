'use client';
import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useChat } from '@/hooks/useChat';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DocumentSidebar, MobileSidebarButton, MobileSidebar } from '@/components/DocumentSidebar';
import { ChatMessage } from '@/components/ChatMessage';
import { Square, Send, Sparkles, Search, FileSearch, Zap, BookOpen, MessageSquare } from 'lucide-react';

const SUGGESTIONS = [
  '这份文档讲了什么？',
  '总结文档的主要观点',
  '文档中提到了哪些关键概念？',
  '对比文档中的不同方案',
];

const FEATURES = [
  { icon: Search, label: '混合检索', desc: '向量 + BM25 双路召回', color: 'from-blue-500 to-cyan-400' },
  { icon: FileSearch, label: 'Rerank 精排', desc: 'Cross-Encoder 重排序', color: 'from-violet-500 to-purple-400' },
  { icon: Zap, label: '流式对话', desc: 'SSE 实时生成', color: 'from-amber-500 to-orange-400' },
  { icon: BookOpen, label: '引用溯源', desc: '答案来源可追溯', color: 'from-emerald-500 to-teal-400' },
];

export default function Home() {
  const messages = useChatStore((s) => s.messages);
  const clear = useChatStore((s) => s.clear);
  const { status, send, stop } = useChat();
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  function submit(q?: string) {
    const text = q ?? input;
    if (!text.trim() || status === 'streaming') return;
    setInput('');
    autoScrollRef.current = true;
    send(text);
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      {/* 桌面端侧边栏 */}
      <DocumentSidebar />

      {/* 移动端侧边栏 Sheet */}
      <MobileSidebar open={sidebarOpen} onOpenChange={setSidebarOpen} />

      <main className="flex-1 flex flex-col max-w-4xl mx-auto p-4 md:p-6 min-w-0">
        <header className="mb-4 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <MobileSidebarButton onClick={() => setSidebarOpen(true)} />
            <div>
              <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 bg-clip-text text-transparent">
                DocQA Agent
              </h1>
              <p className="text-xs md:text-sm text-gray-400 mt-0.5">
                智能文档问答 · RAG + Hybrid Search + SSE
              </p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={clear} className="text-xs">
              清空会话
            </Button>
          )}
        </header>

        <div
          ref={listRef}
          className={`flex-1 overflow-y-auto space-y-4 mb-4 rounded-2xl p-3 md:p-4 ${
            messages.length === 0
              ? 'bg-transparent border-none'
              : 'bg-white/80 backdrop-blur-sm border border-gray-200/60 shadow-sm'
          }`}
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 md:py-14 space-y-6">
              {/* Logo / Hero */}
              <div className="relative">
                <div className="w-20 h-20 md:w-24 md:h-24 rounded-3xl bg-gradient-to-br from-blue-500 via-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-200">
                  <Sparkles className="w-10 h-10 md:w-12 md:h-12 text-white" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                </div>
              </div>

              <div className="text-center space-y-1.5">
                <h2 className="text-lg md:text-xl font-semibold text-gray-800">
                  上传文档，开始提问
                </h2>
                <p className="text-sm text-gray-400 max-w-md">
                  支持 PDF / Word / Markdown / TXT，Agent 将从文档中检索并生成回答
                </p>
              </div>

              {/* Feature Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-lg">
                {FEATURES.map(({ icon: Icon, label, desc, color }) => (
                  <div
                    key={label}
                    className="rounded-xl border border-gray-200/80 bg-white/60 backdrop-blur-sm p-3 text-center hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <div className={`w-8 h-8 mx-auto mb-2 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div className="text-xs font-semibold text-gray-700">{label}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{desc}</div>
                  </div>
                ))}
              </div>

              {/* Suggested Questions */}
              <div className="w-full max-w-md space-y-2">
                <p className="text-xs font-medium text-gray-400 text-center">试试这些问题</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {SUGGESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => submit(q)}
                      className="text-left text-sm rounded-xl border border-gray-200/80 bg-white/50 hover:bg-blue-50/60 hover:border-blue-200 px-3.5 py-2.5 text-gray-600 hover:text-blue-700 transition-all duration-150 group"
                    >
                      <span className="text-blue-400 group-hover:text-blue-500 mr-1.5">→</span>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input Area */}
        <div className="relative group">
          <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-blue-200 via-violet-200 to-purple-200 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 blur-sm" />
          <div className="relative flex gap-2 items-end rounded-2xl bg-white border border-gray-200 p-2 shadow-sm">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入问题，Enter 发送 · Shift+Enter 换行"
              className="resize-none min-h-[48px] md:min-h-[56px] border-0 bg-transparent focus:ring-0 focus-visible:ring-0 p-1"
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
              <Button variant="destructive" onClick={stop} className="h-10 md:h-12 rounded-xl shrink-0">
                <Square className="w-4 h-4 mr-1" />
                停止
              </Button>
            ) : (
              <Button
                onClick={() => submit()}
                disabled={!input.trim()}
                className="h-10 md:h-12 rounded-xl shrink-0 bg-gradient-to-r from-blue-500 to-violet-500 hover:from-blue-600 hover:to-violet-600 shadow-sm"
              >
                <Send className="w-4 h-4" />
                <span className="ml-1">发送</span>
              </Button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-gray-300">
          <span>Built by 朱思麒</span>
          <span>·</span>
          <span>哈工深 23 级计算机</span>
          <span>·</span>
          <span>每日体验 5 次</span>
        </div>
      </main>
    </div>
  );
}
