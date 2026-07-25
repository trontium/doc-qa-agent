/**
 * Usage-limit middleware — 每日用量配额保护
 *
 * 两层防线：
 *   1. Per-IP daily cap  — 每人每天最多 N 次查询（防止一人用完所有额度）
 *   2. Global daily cap  — 全局每天最多 M 次查询（保护 API 预算）
 *
 * 持久化：写入 Supabase usage_logs 表，Vercel 冷启也不丢计数。
 * 频率限流（每分钟）由内存 store 处理，这里只管每日配额。
 *
 * 配置（.env.local）：
 *   DAILY_LIMIT_PER_IP=5      每个 IP 每天最多 5 次对话
 *   DAILY_LIMIT_GLOBAL=30     全局每天最多 30 次对话
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- 配置 ----
const DAILY_LIMIT_PER_IP = Number(process.env.DAILY_LIMIT_PER_IP) || 5;
const DAILY_LIMIT_GLOBAL = Number(process.env.DAILY_LIMIT_GLOBAL) || 30;

// ---- 频率限流（内存，防 burst）----
interface RateEntry { count: number; resetAt: number }
const rateStore = new Map<string, RateEntry>();
const RATE_RULES: Record<string, { limit: number; windowMs: number }> = {
  '/api/chat': { limit: 6, windowMs: 60_000 },   // 6次/分（比每日配额松，防瞬间burst）
  '/api/upload': { limit: 2, windowMs: 60_000 },
};

// ---- Supabase（用量持久化）----
const supabaseUrl = process.env.SUPABASE_URL ?? '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? '';
// 懒初始化：middleware 运行在 Edge，不能在模块顶层 createClient（env 还没注入）
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase && supabaseUrl && supabaseKey) {
    _supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}

// ---- 工具函数 ----
function getIP(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function todayStart(): string {
  // UTC 天起始，和 Supabase timestamptz 比较用
  return new Date(new Date().toISOString().slice(0, 10)).toISOString();
}

function checkRateLimit(ip: string, route: string): { allowed: boolean; retryAfterSec: number } {
  const rule = RATE_RULES[route];
  if (!rule) return { allowed: true, retryAfterSec: 0 };

  const now = Date.now();
  const key = `${ip}:${route}`;
  let entry = rateStore.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + rule.windowMs };
    rateStore.set(key, entry);
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= rule.limit) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

// 清理过期频率条目
let lastCleanup = 0;
function cleanupRate() {
  const now = Date.now();
  if (now - lastCleanup < 300_000) return;
  lastCleanup = now;
  for (const [key, entry] of rateStore) {
    if (now >= entry.resetAt) rateStore.delete(key);
  }
}

// ---- 每日配额检查（异步，查 Supabase）----
async function checkDailyLimit(ip: string, route: string): Promise<{
  allowed: boolean;
  reason?: string;
  ipUsed?: number;
  globalUsed?: number;
}> {
  const db = getSupabase();
  if (!db) return { allowed: true }; // Supabase 不可用时放行

  const today = todayStart();

  // 并行查 IP 计数 + 全局计数
  const [ipRes, globalRes] = await Promise.all([
    (db as any)
      .from('usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('route', route)
      .eq('ip', ip)
      .gte('created_at', today),
    (db as any)
      .from('usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('route', route)
      .gte('created_at', today),
  ]);

  const ipUsed = ipRes.count ?? 0;
  const globalUsed = globalRes.count ?? 0;

  // 全局限流优先（预算保护）
  if (globalUsed >= DAILY_LIMIT_GLOBAL) {
    return {
      allowed: false,
      reason: `今日体验名额已用完（${DAILY_LIMIT_GLOBAL} 次/天），明天再来试试吧`,
      ipUsed,
      globalUsed,
    };
  }

  // Per-IP 限流
  if (ipUsed >= DAILY_LIMIT_PER_IP) {
    return {
      allowed: false,
      reason: `你今天已体验 ${DAILY_LIMIT_PER_IP} 次，明天可以继续试用`,
      ipUsed,
      globalUsed,
    };
  }

  return { allowed: true, ipUsed, globalUsed };
}

// ---- 记录一次使用 ----
async function logUsage(ip: string, route: string) {
  const db = getSupabase();
  if (!db) return;
  await (db as any).from('usage_logs').insert({ ip, route });
}

// ---- 主 middleware ----
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 只对 chat 和 upload API 限流
  const isChat = pathname.startsWith('/api/chat');
  const isUpload = pathname.startsWith('/api/upload');
  if (!isChat && !isUpload) return NextResponse.next();

  const route = isChat ? '/api/chat' : '/api/upload';
  const ip = getIP(req);

  // 第 1 层：频率限流（内存，防 burst）
  cleanupRate();
  const rate = checkRateLimit(ip, route);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSec) },
      }
    );
  }

  // 第 2 层：每日配额限流（Supabase 持久化，防额度耗尽）
  if (isChat) { // upload 不计每日配额（上传频率本身很低）
    const daily = await checkDailyLimit(ip, route);
    if (!daily.allowed) {
      return NextResponse.json(
        {
          error: daily.reason,
          ipUsed: daily.ipUsed,
          globalUsed: daily.globalUsed,
          ipLimit: DAILY_LIMIT_PER_IP,
          globalLimit: DAILY_LIMIT_GLOBAL,
        },
        { status: 429 }
      );
    }
    // 放行 + 异步记录使用（不阻塞响应）
    logUsage(ip, route);
  }

  // 放行
  const res = NextResponse.next();
  res.headers.set('X-RateLimit-Route', route);
  return res;
}

export const config = {
  matcher: ['/api/chat/:path*', '/api/upload/:path*'],
};
