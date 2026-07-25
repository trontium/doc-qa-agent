'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ErrorBoundary]', error);
  }, [error]);

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="text-center space-y-4 max-w-md p-8">
        <div className="text-5xl">😵</div>
        <h2 className="text-xl font-semibold text-gray-800">出了点问题</h2>
        <p className="text-sm text-gray-500">
          页面渲染时发生了错误。可能是网络波动或服务暂时不可用。
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm"
        >
          重试
        </button>
      </div>
    </div>
  );
}
