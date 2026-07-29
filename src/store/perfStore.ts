import { create } from 'zustand';

/**
 * 前端渲染层可观测指标 · 独立于 chatStore
 *
 * 定位：
 * - LangSmith 观测后端 RAG/LLM 链路（token / retrieval / rerank）
 * - 本 store 观测浏览器视角的渲染层指标（LangSmith 看不到）
 *   - TTFB：SSE 首字延迟（含网络 + 边缘节点，非纯后端耗时）
 *   - rAF flush 命中率：rAF batch 有效性证据（简历 bullet 实证）
 *   - Token/s：用户视角的生成速度（含网络 + 渲染）
 *   - Web Vitals：LCP / FCP / INP（纯前端体验指标）
 */

export interface StreamStats {
  /** SSE 首字延迟（ms）：从 fetch 发出到第一个 content chunk 到达 */
  ttfb: number | null;
  /** 生成总时长（ms）：从 stream 开始到完成 */
  duration: number | null;
  /** 收到的 SSE content chunk 总数 */
  chunkCount: number;
  /** 实际触发 rAF flush 的次数 */
  flushCount: number;
  /** 累计写入 UI 的字符数 */
  charCount: number;
  /** 浏览器视角生成速度（char/s） */
  charsPerSec: number | null;
  /** rAF batch 合并命中率 = 1 - flush/chunk */
  batchHitRate: number | null;
  /** 当前是否正在生成 */
  isStreaming: boolean;
  /** 稳定块数（增量 Markdown 解析：已凝固不再重 parse 的段落数） */
  stableBlocks: number;
}

export interface HljsStats {
  /** Web Worker 高亮任务总数（Worker 收到 postMessage 的次数） */
  taskCount: number;
  /** Worker 高亮总耗时（ms）· 主线程实际阻塞 0 */
  totalMs: number;
  /** 单次最大耗时 */
  maxMs: number;
  /** 缓存命中数（同代码块重复高亮走 LRU） */
  cacheHits: number;
}

export interface WebVitals {
  fcp: number | null; // First Contentful Paint
  lcp: number | null; // Largest Contentful Paint
  inp: number | null; // Interaction to Next Paint（累计最大）
}

interface PerfState {
  current: StreamStats;
  last: StreamStats | null;
  vitals: WebVitals;
  hljs: HljsStats;

  // Stream lifecycle
  streamStart: () => void;
  markFirstByte: () => void;
  addChunk: (chars: number) => void;
  addFlush: () => void;
  setStableBlocks: (n: number) => void;
  streamEnd: () => void;

  // Web Vitals
  setVital: (k: keyof WebVitals, v: number) => void;

  // hljs Worker
  recordHljsTask: (ms: number) => void;
  recordHljsCacheHit: () => void;
}

const initialStats: StreamStats = {
  ttfb: null,
  duration: null,
  chunkCount: 0,
  flushCount: 0,
  charCount: 0,
  charsPerSec: null,
  batchHitRate: null,
  isStreaming: false,
  stableBlocks: 0,
};

let streamStartAt = 0;

export const usePerfStore = create<PerfState>((set) => ({
  current: initialStats,
  last: null,
  vitals: { fcp: null, lcp: null, inp: null },
  hljs: { taskCount: 0, totalMs: 0, maxMs: 0, cacheHits: 0 },

  streamStart: () => {
    streamStartAt = performance.now();
    set({
      current: { ...initialStats, isStreaming: true },
    });
  },

  markFirstByte: () => {
    set((s) => {
      // 仅首次记录
      if (s.current.ttfb != null) return s;
      return {
        current: { ...s.current, ttfb: Math.round(performance.now() - streamStartAt) },
      };
    });
  },

  addChunk: (chars: number) => {
    set((s) => ({
      current: {
        ...s.current,
        chunkCount: s.current.chunkCount + 1,
        charCount: s.current.charCount + chars,
      },
    }));
  },

  addFlush: () => {
    set((s) => ({
      current: { ...s.current, flushCount: s.current.flushCount + 1 },
    }));
  },

  setStableBlocks: (n: number) => {
    set((s) => {
      // 只在增大时更新（本次流式的最大稳定块数即最终值）
      if (n <= s.current.stableBlocks) return s;
      return { current: { ...s.current, stableBlocks: n } };
    });
  },

  streamEnd: () => {
    set((s) => {
      const duration = Math.round(performance.now() - streamStartAt);
      const cps =
        duration > 0 && s.current.charCount > 0
          ? Math.round((s.current.charCount / duration) * 1000)
          : null;
      const hit =
        s.current.chunkCount > 0
          ? 1 - s.current.flushCount / s.current.chunkCount
          : null;
      const final: StreamStats = {
        ...s.current,
        duration,
        charsPerSec: cps,
        batchHitRate: hit,
        isStreaming: false,
      };
      return { current: final, last: final };
    });
  },

  setVital: (k, v) => {
    set((s) => ({ vitals: { ...s.vitals, [k]: Math.round(v) } }));
  },

  recordHljsTask: (ms) => {
    set((s) => ({
      hljs: {
        ...s.hljs,
        taskCount: s.hljs.taskCount + 1,
        totalMs: s.hljs.totalMs + ms,
        maxMs: Math.max(s.hljs.maxMs, ms),
      },
    }));
  },

  recordHljsCacheHit: () => {
    set((s) => ({
      hljs: { ...s.hljs, cacheHits: s.hljs.cacheHits + 1 },
    }));
  },
}));
