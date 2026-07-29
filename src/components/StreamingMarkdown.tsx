'use client';
import { memo, useEffect, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { usePerfStore } from '@/store/perfStore';

/**
 * StreamingMarkdown · 流式 Markdown 增量渲染
 *
 * 解决的问题（面试可讲的问题链）:
 * 1. 每个 SSE chunk 到来 → content 字符串变化 → ReactMarkdown 全量 re-parse AST
 *    → remark-gfm 全量处理 → rehype-highlight 全量重新高亮所有代码块
 *    → 主线程被 parse + hljs 反复阻塞
 *
 * 三层优化:
 * A. 块级切分 (Block Splitting)
 *    - 按「两个连续换行 + 已闭合代码围栏」将 markdown 切成稳定块
 *    - 除最后一块外，前面的块都已稳定，不会再变
 *
 * B. 稳定块记忆化 (Block Memoization)
 *    - 每个稳定块用独立组件渲染，React.memo 靠 text 相等判断
 *    - 首次 parse 后，同一块内容不变则跳过重渲
 *
 * C. 未闭合代码块延迟高亮 (Deferred Highlighting)
 *    - 尾部块若包含未闭合 ```，不挂 rehype-highlight 插件
 *    - 一旦 ``` 闭合（下一批 chunk），才触发一次 hljs 高亮
 *    - 避免"每 chunk 都高亮一次不完整代码"的浪费
 */

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS_WITH_HL = [rehypeHighlight];
const REHYPE_PLUGINS_NO_HL: [] = [];

/**
 * 把 markdown 切成稳定块 + 尾部动态块
 * 切分规则：
 *   - 双换行是段落边界
 *   - 但如果处于「未闭合的 ``` 代码围栏」内部，双换行不算边界
 */
function splitBlocks(md: string): { stable: string[]; tail: string } {
  const parts: string[] = [];
  let inFence = false;
  const lines = md.split('\n');
  let bufStart = 0;
  // 「稳定边界」定义：不在围栏内的一个空行（"\n\n" 拆开后的 "" 那一行）
  // 且该空行之后至少还有一行内容（否则说明是 markdown 结尾，不能切）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 检测 ``` 围栏（简化：不处理 ~~~）
    if (/^```/.test(line.trimStart())) {
      inFence = !inFence;
    }
    // 段落边界：不在围栏内 且 是空行 且 前面有非空内容 且 后面还有内容
    if (
      !inFence &&
      line === '' &&
      i > bufStart &&
      i < lines.length - 1 &&
      lines.slice(bufStart, i).some((l) => l.trim() !== '')
    ) {
      const chunk = lines.slice(bufStart, i).join('\n');
      if (chunk.trim()) parts.push(chunk);
      bufStart = i + 1;
    }
  }

  // 尾部：bufStart 到末尾（可能包含未闭合围栏 / 仍在生成的最后一段）
  const tail = lines.slice(bufStart).join('\n');

  return { stable: parts, tail };
}

/**
 * 判断字符串中是否存在未闭合的 ``` 围栏
 * 用于决定是否跳过 rehype-highlight（延迟高亮）
 */
function hasUnclosedFence(md: string): boolean {
  const matches = md.match(/^```/gm);
  return matches != null && matches.length % 2 === 1;
}

interface StreamingMarkdownProps {
  content: string;
  isStreaming: boolean;
  components?: Components;
}

/**
 * 单个稳定块 · memo 到 text 相等即跳过
 */
const StableBlock = memo(
  function StableBlock({ text, components }: { text: string; components?: Components }) {
    return (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS_WITH_HL}
        components={components}
      >
        {text}
      </ReactMarkdown>
    );
  },
  (prev, next) => prev.text === next.text
);

/**
 * 尾部块 · 每次 chunk 变化都 re-parse，但根据是否有未闭合围栏动态挂 rehype-highlight
 */
function TailBlock({
  text,
  isStreaming,
  components,
}: {
  text: string;
  isStreaming: boolean;
  components?: Components;
}) {
  const hasOpenFence = useMemo(() => hasUnclosedFence(text), [text]);
  // 流式期间遇到未闭合 fence → 跳过 hljs（延迟高亮）
  const rehypes = isStreaming && hasOpenFence ? REHYPE_PLUGINS_NO_HL : REHYPE_PLUGINS_WITH_HL;
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypes}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}

export function StreamingMarkdown({
  content,
  isStreaming,
  components,
}: StreamingMarkdownProps) {
  // 非流式或短内容：直接一整块（避免切分开销）
  const { stable, tail } = useMemo(() => {
    if (!isStreaming || content.length < 200) {
      return { stable: [] as string[], tail: content };
    }
    return splitBlocks(content);
  }, [content, isStreaming]);

  // 上报稳定块数到 perfStore（作为「增量解析」有效性的实证）
  useEffect(() => {
    if (isStreaming && stable.length > 0) {
      usePerfStore.getState().setStableBlocks(stable.length);
    }
  }, [stable.length, isStreaming]);

  return (
    <>
      {stable.map((text, i) => (
        <StableBlock key={`s-${i}-${text.length}`} text={text} components={components} />
      ))}
      {tail && (
        <TailBlock text={tail} isStreaming={isStreaming} components={components} />
      )}
    </>
  );
}

