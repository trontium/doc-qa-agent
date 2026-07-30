'use client';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
// 通过 globals.css 的 .hljs 变量切换主题，无需直接 import hljs css
import type { Message } from '@/types/message';
import { ToolCallDetail } from './ToolCallDetail';
import { StreamingMarkdown } from './StreamingMarkdown';

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
      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        // 只允许 http/https 协议链接，防止 javascript: XSS
        const safeHref = href && href.startsWith('http') ? href : undefined;
        return (
          <a href={safeHref} target="_blank" rel="noreferrer" className="underline">
            {children}
          </a>
        );
      },
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
            ? 'bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-sm shadow-blue-200 dark:shadow-blue-900/40'
            : 'bg-card border border-border shadow-sm'
        }`}
      >
        <div className={`text-xs mb-1 ${isUser ? 'text-white/70' : 'text-muted-foreground'}`}>
          {isUser ? '你' : '🤖 Assistant'}
          {isStreaming && (
            <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          )}
        </div>

        {/* 阶段指示器：检索中 / 生成中 */}
        {!isUser && isStreaming && message.stage && !message.content && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            {message.stage === 'retrieving' ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                🔍 检索相关文档…
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                ✍️ 组织回答中…
              </>
            )}
          </div>
        )}

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
        ) : isStreaming && !message.content ? (
          // 流式开始但还没收到第一个 chunk：渲染骨架行（避免把"⏳ 思考中"喂给 Markdown 解析器）
          <div className="space-y-2 py-1" role="status" aria-label="正在生成回答">
            <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
            <div className="h-3 w-full bg-muted rounded animate-pulse" />
            <div className="h-3 w-5/6 bg-muted rounded animate-pulse" />
          </div>
        ) : (
          <div className="prose prose-sm max-w-none break-words prose-p:my-2 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none dark:prose-invert">
            <StreamingMarkdown
              content={message.content}
              isStreaming={isStreaming}
              components={markdownComponents}
            />
          </div>
        )}

        {message.status === 'aborted' && (
          <div className="mt-2 text-xs text-orange-600 dark:text-orange-400">⚠ 已停止</div>
        )}
        {message.status === 'error' && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">⚠ 出错，请重试</div>
        )}

        {/* 引用卡片 + 检索链路：RAG 可解释性 UI */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border space-y-2">
            <div className="text-xs text-muted-foreground font-semibold">
              📎 引用（{message.citations.length}）· 点击 [n] 定位
            </div>

            {/* 原生 details：零 JS 状态、键盘可访问；默认折叠，不干扰阅读 */}
            {message.retrievalMeta && (
              <details className="group rounded-lg border border-violet-100 dark:border-violet-900/60 bg-violet-50/60 dark:bg-violet-950/20 p-2.5 text-[11px]">
                <summary className="cursor-pointer list-none text-violet-700 dark:text-violet-300 hover:underline">
                  <span className="group-open:hidden">查看检索链路 ▼</span>
                  <span className="hidden group-open:inline">收起检索链路 ▲</span>
                </summary>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-violet-800 dark:text-violet-300">检索决策链路</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      message.retrievalMeta.rerankApplied
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                    }`}>
                      {message.retrievalMeta.rerankApplied ? 'Cross-Encoder 精排已生效' : 'Rerank 降级为 RRF'}
                    </span>
                  </div>
                  <TraceRow label="原始问题" value={message.retrievalMeta.originalQuery} />
                  <TraceRow label="检索 Query" value={message.retrievalMeta.rewrittenQuery} accent />
                  <div className="text-[10px] text-muted-foreground pt-0.5">
                    Query Rewrite → Hybrid Search（向量 + BM25）→ RRF → {message.retrievalMeta.rerankApplied ? 'Cross-Encoder Rerank' : 'RRF 结果直出'}
                  </div>
                </div>
              </details>
            )}

            {message.citations.map((c) => {
              const isHighlighted = highlightIndex === c.index;
              return (
                <div
                  key={c.index}
                  ref={(el) => {
                    citationRefs.current.set(c.index, el);
                  }}
                  className={`text-xs rounded-lg p-2 border-l-2 transition-all duration-300 ${
                    isHighlighted
                      ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-400 shadow-md scale-[1.02]'
                      : 'bg-muted/50 border-blue-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <div className="font-medium text-foreground min-w-0 truncate">
                      [{c.index}] {c.source ?? '未知来源'}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {c.chunkIndex != null && (
                        <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">片段 {c.chunkIndex + 1}</span>
                      )}
                      {/* 仅展示真实 Cross-Encoder 分，不拿向量分数冒充 */}
                      {typeof c.rerankScore === 'number' && (
                        <span className="rounded bg-emerald-100 dark:bg-emerald-950/60 px-1 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                          精排 {c.rerankScore.toFixed(3)}
                        </span>
                      )}
                    </div>
                  </div>
                  {c.content.length > 120 ? (
                    <details className="group">
                      <summary className="cursor-pointer list-none text-muted-foreground">
                        {/* max-height 兜底：不依赖 line-clamp 插件，确保默认只展示约 3 行 */}
                        <span className="block whitespace-pre-wrap leading-4 max-h-12 overflow-hidden group-open:hidden">{c.content}</span>
                        <span className="hidden whitespace-pre-wrap group-open:block">{c.content}</span>
                        <span className="mt-1 block text-[10px] text-blue-600 dark:text-blue-400 group-open:hidden">展开完整片段 ▼</span>
                        <span className="mt-1 hidden text-[10px] text-blue-600 dark:text-blue-400 group-open:block">收起片段 ▲</span>
                      </summary>
                    </details>
                  ) : (
                    <div className="text-muted-foreground whitespace-pre-wrap">{c.content}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TraceRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`break-words ${accent ? 'font-medium text-violet-800 dark:text-violet-200' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}

// React.memo：只在实际展示相关字段变化时重渲
export const ChatMessage = memo(ChatMessageComp, (prev, next) => {
  return (
    prev.message.content === next.message.content &&
    prev.message.status === next.message.status &&
    prev.message.citations === next.message.citations &&
    prev.message.retrievalMeta === next.message.retrievalMeta &&
    prev.message.toolCalls === next.message.toolCalls
  );
});
