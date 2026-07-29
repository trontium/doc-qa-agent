/**
 * hljs Worker 主线程客户端
 *
 * - 单例 Worker：整个 App 只 spawn 一次
 * - Promise 化：每个请求生成 id，收到对应 id 的 response 时 resolve
 * - LRU 缓存：相同 code + lang 直接返回缓存（流式场景稳定块重复渲染很多次）
 * - 惰性初始化：首次调用才 spawn Worker，SSR 环境不触发
 */

import { usePerfStore } from '@/store/perfStore';

interface WorkerResp {
  id: string;
  html: string;
  language?: string;
  error?: string;
}

type Pending = {
  resolve: (v: { html: string; language?: string }) => void;
  reject: (e: Error) => void;
};

let worker: Worker | null = null;
const pending = new Map<string, Pending>();

// LRU 缓存（最多 200 项）
const CACHE_LIMIT = 200;
const cache = new Map<string, { html: string; language?: string }>();

function cacheKey(code: string, lang?: string) {
  return `${lang ?? ''}::${code}`;
}

function lruGet(k: string) {
  const v = cache.get(k);
  if (v) {
    // touch: 移到末尾（Map 保持插入顺序）
    cache.delete(k);
    cache.set(k, v);
  }
  return v;
}

function lruSet(k: string, v: { html: string; language?: string }) {
  if (cache.has(k)) cache.delete(k);
  cache.set(k, v);
  if (cache.size > CACHE_LIMIT) {
    // 删除最早的
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

function ensureWorker(): Worker | null {
  if (typeof window === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/hljs.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (e: MessageEvent<WorkerResp>) => {
      const { id, html, language, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) {
        p.reject(new Error(error));
      } else {
        const v = { html, language };
        p.resolve(v);
      }
    });
    worker.addEventListener('error', (ev) => {
      // Worker 崩溃：拒掉所有 pending
      for (const p of pending.values()) {
        p.reject(new Error(ev.message ?? 'worker error'));
      }
      pending.clear();
    });
  } catch {
    worker = null;
  }
  return worker;
}

export function highlightInWorker(
  code: string,
  lang?: string
): Promise<{ html: string; language?: string }> {
  // 优先命中缓存
  const key = cacheKey(code, lang);
  const cached = lruGet(key);
  if (cached) {
    usePerfStore.getState().recordHljsCacheHit();
    return Promise.resolve(cached);
  }

  const w = ensureWorker();
  if (!w) {
    // 无 window / 无 Worker 支持 → 直接返回原样，交给外层降级
    return Promise.reject(new Error('worker unavailable'));
  }

  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pending.set(id, {
      resolve: (v) => {
        lruSet(key, v);
        resolve(v);
      },
      reject,
    });
    w.postMessage({ id, code, lang });
  });
}
