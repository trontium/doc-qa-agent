'use client';
import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 组件级 ErrorBoundary
 *
 * 为什么不用 react-error-boundary:
 * - 零依赖, 手写 ~50 行足够
 * - 可自定义 fallback 渲染函数, 可拿到 error
 *
 * 使用:
 *   <ErrorBoundary fallback={(err) => <div>渲染失败: {err.message}</div>}>
 *     <ChatMessage message={...} />
 *   </ErrorBoundary>
 */

interface Props {
  children: ReactNode;
  /** 渲染出错时的降级 UI（函数或静态 ReactNode） */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** 出错时回调（用于上报） */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 生产环境上报到 LangSmith / Sentry 的入口
    this.props.onError?.(error, info);
    // 开发环境打印
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorBoundary]', error, info);
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;
    if (error) {
      if (typeof fallback === 'function') return fallback(error, this.reset);
      if (fallback !== undefined) return fallback;
      return (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold mb-1">⚠ 渲染失败</div>
          <div className="opacity-80 break-all">{error.message}</div>
          <button
            onClick={this.reset}
            className="mt-2 px-2 py-1 rounded bg-red-600 text-white text-[11px] hover:bg-red-700"
          >
            重试
          </button>
        </div>
      );
    }
    return children;
  }
}
