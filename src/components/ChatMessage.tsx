'use client';
import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import type { Message } from '@/types/message';

// 组件外定义避免每次新引用破坏 memo（原简历宝典 §9.2 优化点）
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

function ChatMessageComp({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isStreaming = message.status === 'streaming';

  // 引用 [n] 交互：滚动到引用卡片 + 高亮 200ms
  const contentWithCitations = useMemo(() => {
    if (isUser || !message.citations?.length) return message.content;
    return message.content;
  }, [message.content, message.citations, isUser]);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-500 text-white'
            : 'bg-white border shadow-sm'
        }`}
      >
        <div className={`text-xs mb-1 opacity-70 ${isUser ? 'text-white/90' : 'text-gray-500'}`}>
          {isUser ? '👤 你' : '🤖 Assistant'}
          {isStreaming && (
            <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          )}
        </div>

        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div className="prose prose-sm max-w-none break-words prose-p:my-2 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer" className="underline">
                    {children}
                  </a>
                ),
              }}
            >
              {contentWithCitations || (isStreaming ? '⏳ 思考中…' : '')}
            </ReactMarkdown>
          </div>
        )}

        {message.status === 'aborted' && (
          <div className="mt-2 text-xs text-orange-600">⚠ 已停止</div>
        )}
        {message.status === 'error' && (
          <div className="mt-2 text-xs text-red-600">⚠ 出错，请重试</div>
        )}

        {/* 引用卡片列表 */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-3 pt-3 border-t space-y-1.5">
            <div className="text-xs text-gray-500 font-semibold">📎 引用（{message.citations.length}）</div>
            {message.citations.map((c) => (
              <div
                key={c.index}
                className="text-xs bg-gray-50 rounded p-2 border-l-2 border-blue-400"
              >
                <div className="font-medium text-gray-700 mb-0.5">
                  [{c.index}] {c.source ?? '未知来源'}
                </div>
                <div className="text-gray-600 line-clamp-3">{c.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// React.memo：只在 status/content/citations 变化时重渲，避免流式期间其他消息也 diff
export const ChatMessage = memo(ChatMessageComp, (prev, next) => {
  return (
    prev.message.content === next.message.content &&
    prev.message.status === next.message.status &&
    prev.message.citations === next.message.citations
  );
});
