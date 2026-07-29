'use client';
import { useEffect, useState } from 'react';
import { Activity, X, ChevronDown, ChevronUp } from 'lucide-react';
import { usePerfStore } from '@/store/perfStore';
import { initWebVitals } from '@/lib/web-vitals';

/**
 * 前端渲染层可观测面板
 *
 * 定位：
 * - LangSmith 已有 → 后端 RAG/LLM 观测（token / retrieval / rerank）
 * - 本面板 → 浏览器渲染层观测（LangSmith 完全看不到的维度）
 *
 * 指标：
 * - TTFB：SSE 首字延迟（浏览器视角，含网络+边缘节点）
 * - Token/s：用户视角的生成速度（含渲染）
 * - rAF batch 命中率：简历 bullet 关于「rAF 批量合并 token」的实证
 * - LCP / FCP / INP：Web Vitals
 */

function fmt(v: number | null, unit = ''): string {
  if (v == null) return '—';
  return `${v}${unit}`;
}

function fmtRate(v: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function ratingClass(kind: 'lcp' | 'fcp' | 'inp' | 'ttfb', v: number | null): string {
  if (v == null) return 'text-gray-400';
  // 使用 Web Vitals 官方阈值（宽松版）
  const thresholds: Record<string, [number, number]> = {
    lcp: [2500, 4000],
    fcp: [1800, 3000],
    inp: [200, 500],
    ttfb: [800, 1800],
  };
  const [good, needs] = thresholds[kind];
  if (v <= good) return 'text-emerald-600';
  if (v <= needs) return 'text-amber-600';
  return 'text-rose-600';
}

export function PerfPanel() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const current = usePerfStore((s) => s.current);
  const last = usePerfStore((s) => s.last);
  const vitals = usePerfStore((s) => s.vitals);
  const hljs = usePerfStore((s) => s.hljs);

  useEffect(() => {
    initWebVitals();
  }, []);

  // 展示口径：正在流式则用 current 实时；否则用 last（历史）
  const view = current.isStreaming ? current : last ?? current;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="打开性能面板"
        className="fixed bottom-4 right-4 z-40 h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 shadow-lg shadow-violet-200 hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-white"
        title="前端渲染层可观测面板"
      >
        <Activity className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white/95 backdrop-blur shadow-xl overflow-hidden text-[11px] font-mono">
      <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-blue-50 to-violet-50 border-b border-gray-100">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-violet-600" />
          <span className="text-xs font-sans font-semibold text-gray-700">
            前端渲染观测
          </span>
          {current.isStreaming && (
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-emerald-600 font-sans">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 rounded hover:bg-white/70"
            aria-label={collapsed ? '展开' : '折叠'}
          >
            {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-white/70"
            aria-label="关闭面板"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-3">
          {/* SSE 流式指标 */}
          <section>
            <div className="text-[10px] font-sans text-gray-400 mb-1.5 tracking-wide">
              SSE STREAM {current.isStreaming ? '(实时)' : last ? '(上次)' : ''}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Metric label="TTFB 首字" value={fmt(view.ttfb, 'ms')} colorClass={ratingClass('ttfb', view.ttfb)} />
              <Metric label="总耗时" value={fmt(view.duration, 'ms')} />
              <Metric label="Char/s" value={fmt(view.charsPerSec)} />
              <Metric label="字符数" value={fmt(view.charCount)} />
              <Metric label="SSE chunks" value={fmt(view.chunkCount)} />
              <Metric label="rAF flush" value={fmt(view.flushCount)} />
              <Metric label="MD 稳定块" value={fmt(view.stableBlocks)} />
              <Metric label="" value="" />
            </div>
            <div className="mt-2 rounded-lg bg-gradient-to-r from-blue-50 to-violet-50 px-2.5 py-1.5 border border-blue-100/50">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-sans text-gray-500">rAF batch 命中率</span>
                <span className="text-xs font-semibold text-violet-700">
                  {fmtRate(view.batchHitRate)}
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-white/70 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
                  style={{ width: `${((view.batchHitRate ?? 0) * 100).toFixed(1)}%` }}
                />
              </div>
              <div className="text-[9px] text-gray-400 mt-1 font-sans">
                (chunks − flush) / chunks · rAF 批量合并 token 有效性
              </div>
            </div>
          </section>

          {/* hljs Web Worker */}
          <section className="pt-1 border-t border-gray-100">
            <div className="text-[10px] font-sans text-gray-400 mb-1.5 tracking-wide">
              HLJS WORKER · 主线程 0 阻塞
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Metric label="任务数" value={fmt(hljs.taskCount)} />
              <Metric label="缓存命中" value={fmt(hljs.cacheHits)} />
              <Metric label="Worker 总耗时" value={fmt(Math.round(hljs.totalMs), 'ms')} />
              <Metric label="单次最大" value={fmt(Math.round(hljs.maxMs), 'ms')} />
            </div>
          </section>

          {/* Web Vitals */}
          <section className="pt-1 border-t border-gray-100">
            <div className="text-[10px] font-sans text-gray-400 mb-1.5 tracking-wide">
              WEB VITALS
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Metric label="FCP" value={fmt(vitals.fcp, 'ms')} colorClass={ratingClass('fcp', vitals.fcp)} />
              <Metric label="LCP" value={fmt(vitals.lcp, 'ms')} colorClass={ratingClass('lcp', vitals.lcp)} />
              <Metric label="INP" value={fmt(vitals.inp, 'ms')} colorClass={ratingClass('inp', vitals.inp)} />
            </div>
          </section>

          <div className="text-[9px] text-gray-400 font-sans leading-relaxed pt-1 border-t border-gray-100">
            仅浏览器渲染层指标 · 后端 RAG/LLM 观测由 LangSmith 负责
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  colorClass = 'text-gray-800',
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  // 空 label 保留占位以维持 grid 对齐
  if (!label) return <div />;
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400 font-sans text-[10px]">{label}</span>
      <span className={`font-semibold ${colorClass}`}>{value}</span>
    </div>
  );
}
