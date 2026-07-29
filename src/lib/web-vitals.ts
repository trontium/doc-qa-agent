/**
 * 轻量 Web Vitals 采集 · 无第三方依赖
 *
 * 只关心三个纯前端指标（LangSmith 完全看不到）：
 * - FCP: First Contentful Paint
 * - LCP: Largest Contentful Paint（最终值：pagehide/hidden 时的最后一次）
 * - INP: Interaction to Next Paint（近似：event → next frame 的最大耗时）
 */

import { usePerfStore } from '@/store/perfStore';

type SafePO = typeof PerformanceObserver | undefined;

function safeObserve(type: string, cb: PerformanceObserverCallback) {
  const PO: SafePO = typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : undefined;
  if (!PO) return;
  try {
    const po = new PO(cb);
    // 部分老浏览器不支持某些 type，try/catch 兜底
    po.observe({ type, buffered: true } as PerformanceObserverInit);
  } catch {
    /* 不支持该类型时静默跳过 */
  }
}

export function initWebVitals() {
  if (typeof window === 'undefined') return;
  const set = usePerfStore.getState().setVital;

  // FCP
  safeObserve('paint', (list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint') {
        set('fcp', entry.startTime);
      }
    }
  });

  // LCP（记录最新值即可，"最终值"由 pagehide 决定，这里对 Demo 展示足够）
  safeObserve('largest-contentful-paint', (list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1] as PerformanceEntry | undefined;
    if (last) set('lcp', last.startTime);
  });

  // INP 近似：观察长任务 + event timing，取最大值
  safeObserve('event', (list) => {
    let maxDur = 0;
    for (const entry of list.getEntries()) {
      // duration = start → next paint（浏览器内部计算）
      if (entry.duration > maxDur) maxDur = entry.duration;
    }
    if (maxDur > 0) {
      const cur = usePerfStore.getState().vitals.inp ?? 0;
      if (maxDur > cur) set('inp', maxDur);
    }
  });
}
