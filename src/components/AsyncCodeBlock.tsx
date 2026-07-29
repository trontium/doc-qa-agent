'use client';
import { memo, useEffect, useState, type HTMLAttributes } from 'react';
import { highlightInWorker } from '@/lib/hljs-client';
import { usePerfStore } from '@/store/perfStore';

/**
 * 异步语法高亮代码块
 *
 * 流程：
 * 1. 挂载时先渲染纯文本（0 阻塞主线程）
 * 2. 向 Worker 发 code + lang，Worker 里跑 hljs
 * 3. 拿到高亮 HTML 后 setState 更新，dangerouslySetInnerHTML 注入
 * 4. Worker 已保证输出的 HTML 只含 hljs 的 span class，无脚本注入风险
 *
 * 对比原版 rehype-highlight：
 * - 原版：ReactMarkdown 主线程同步 parse + 高亮，长代码块阻塞 20-50ms
 * - 现版：主线程只 postMessage 和 patch innerHTML，Worker 独立线程高亮
 */

interface Props extends HTMLAttributes<HTMLElement> {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function AsyncCodeBlockImpl(props: Props & { node?: unknown }) {
  // 过滤掉 react-markdown 传入但不应流到 DOM 的 node prop
  const { inline, className, children, node: _node, ...rest } = props;
  void _node;
  // react-markdown 的 <code> children 一定是字符串
  const raw = typeof children === 'string' ? children : String(children ?? '');

  // 提取 language-xxx
  const langMatch = className?.match(/language-(\w+)/);
  const lang = langMatch?.[1];

  // react-markdown v10 不再传 inline prop；用「有 language-* 或含换行」判定为块级
  const isBlock = Boolean(lang) || raw.includes('\n');
  const treatInline = inline === true || !isBlock;

  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (treatInline) return;
    // 短代码（<40 char）不值得跨线程通信
    if (raw.length < 40) return;

    let cancelled = false;
    const t0 = performance.now();
    highlightInWorker(raw, lang)
      .then((res) => {
        if (cancelled) return;
        setHtml(res.html);
        const dur = performance.now() - t0;
        usePerfStore.getState().recordHljsTask(dur);
      })
      .catch(() => {
        // 降级：不高亮
      });

    return () => {
      cancelled = true;
    };
  }, [raw, lang, treatInline]);

  // inline / 短代码：保持原生 <code>
  if (treatInline) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  // 高亮未完成：渲染纯文本（0 主线程成本）
  if (html === null) {
    return (
      <code className={`${className ?? ''} hljs`} {...rest}>
        {raw}
      </code>
    );
  }

  // Worker 已完成 → 注入
  return (
    <code
      className={`${className ?? ''} hljs`}
      dangerouslySetInnerHTML={{ __html: html }}
      {...rest}
    />
  );
}

export const AsyncCodeBlock = memo(AsyncCodeBlockImpl);
