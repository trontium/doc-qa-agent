'use client';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import type { Message } from '@/types/message';
import { ToolCallDetail } from './ToolCallDetail';

// 组件外定义避免每次新引用破坏 memo（原简历宝典 §9.2 优化点）
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

/**
 * 把 Markdown text 里出现的 [n] 转成可点击的高亮引用标记
 * 通过 remarkPlugins 处理成本比较高，这里用 react-markdown 的 components.text 拦截
 */
function makeCitationRenderer(
  onCite: (index: number) => void
) {
  return function CitationText({ children }: { children?: ReactNode }) {
    if (typeof children !== 'string') return <>{children}</>;
    const parts: ReactNode[] = [];
    const regex = /\[(\d{1,2})\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(children)) !== null) {
      if (m.index > last) parts.push(children.slice(last, m.index));
      const idx = parseInt(m[1], 10);
      parts.push(
        <button
          key={`${m.index}-${idx}`}
          type="button"
          onClick={() => onCite(idx)}
          className="inline-flex items-center align-baseline text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded px-1 mx-0.5 cursor-pointer transition-colors"
        >
          [{idx}]
        </button>
      );
      last = m.index + m[0].length;
    }
    if (last < children.length) parts.push(children.slice(last));
    return <>{parts}</>;
  };
}

function ChatMessageComp({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isStreaming = message.status === 'streaming';

  const citationRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);

  const handleCite = useCallback((index: number) => {
    const el = citationRefs.current.get(index);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightIndex(index);
    window.setTimeout(() => setHighlightIndex(null), 1500);
  }, []);

  const markdownComponents = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a href={href} target="_blank" rel="noreferrer" className="underline">
          {children}
        </a>
      ),
      // 拦截文本节点渲染，把 [n] 转成可点击按钮
      p: ({ children }: { children?: ReactNode }) => {
        const CitationText = makeCitationRenderer(handleCite);
        return (
          <p>
            {Array.isArray(children)
              ? children.map((c, i) =>
                  typeof c === 'string' ? (
                    <CitationText key={i}>{c}</CitationText>
                  ) : (
                    <span key={i}>{c}</span>
                  )
                )
              : typeof children === 'string'
                ? <CitationText>{children}</CitationText>
                : children}
          </p>
        );
      },
      li: ({ children }: { children?: ReactNode }) => {
        const CitationText = makeCitationRenderer(handleCite);
        return (
          <li>
            {Array.isArray(children)
              ? children.map((c, i) =>
                  typeof c === 'string' ? (
                    <CitationText key={i}>{c}</CitationText>
                  ) : (
                    <span key={i}>{c}</span>
                  )
                )
              : typeof children === 'string'
                ? <CitationText>{children}</CitationText>
                : children}
          </li>
        );
      },
    }),
    [handleCite]
  );

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

        {/* 工具调用状态：可展开详情 */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {message.toolCalls.map((t, i) => (
              <ToolCallDetail key={`${t.name}-${i}`} toolCall={t} />
            ))}
          </div>
        )}

        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div className="prose prose-sm max-w-none break-words prose-p:my-2 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={markdownComponents}
            >
              {message.content || (isStreaming ? '⏳ 思考中…' : '')}
            </ReactMarkdown>
          </div>
        )}

        {message.status === 'aborted' && (
          <div className="mt-2 text-xs text-orange-600">⚠ 已停止</div>
        )}
        {message.status === 'error' && (
          <div className="mt-2 text-xs text-red-600">⚠ 出错，请重试</div>
        )}

        {/* 引用卡片列表（点击 [n] 会滚动到对应卡片并高亮 1.5s） */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-3 pt-3 border-t space-y-1.5">
            <div className="text-xs text-gray-500 font-semibold">
              📎 引用（{message.citations.length}）· 点击回答中的 [n] 定位
            </div>
            {message.citations.map((c) => {
              const isHighlighted = highlightIndex === c.index;
              return (
                <div
                  key={c.index}
                  ref={(el) => {
                    citationRefs.current.set(c.index, el);
                  }}
                  className={`text-xs rounded p-2 border-l-2 transition-all duration-300 ${
                    isHighlighted
                      ? 'bg-yellow-100 border-yellow-500 shadow-md scale-[1.02]'
                      : 'bg-gray-50 border-blue-400'
                  }`}
                >
                  <div className="font-medium text-gray-700 mb-0.5">
                    [{c.index}] {c.source ?? '未知来源'}
                  </div>
                  <div className={`text-gray-600 ${isHighlighted ? '' : 'line-clamp-3'}`}>
                    {c.content}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// React.memo：只在 status/content/citations/toolCalls 变化时重渲
export const ChatMessage = memo(ChatMessageComp, (prev, next) => {
  return (
    prev.message.content === next.message.content &&
    prev.message.status === next.message.status &&
    prev.message.citations === next.message.citations &&
    prev.message.toolCalls === next.message.toolCalls
  );
});
