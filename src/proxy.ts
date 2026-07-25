/**
 * Usage-limit proxy — 每日用量配额保护
 *
 * 两层防线：
 *   1. Per-IP daily cap  — 每人每天最多 N 次查询（防止一人用完所有额度）
 *   2. Global daily cap  — 全局每天最多 M 次查询（保护 API 预算）
 *
 * 持久化：写入 Supabase usage_logs 表，Vercel 冷启也不丢计数。
 * 频率限流（每分钟）由内存 store 处理，这里只管每日配额。
 *
 * 安全加固：
 *   - IP 提取取 X-Forwarded-For 最后一个值（Vercel 追加的真实 IP）
 *   - Supabase 不可用时拒绝请求（fail-closed），不放行
 *   - 所有写操作 API 均需 ADMIN_TOKEN 认证
 *
 * 配置（.env.local）：
 *   DAILY_LIMIT_PER_IP=5      每个 IP 每天最多 5 次对话
 *   DAILY_LIMIT_GLOBAL=30     全局每天最多 30 次对话
 *   ADMIN_TOKEN=your-secret   管理操作（upload/delete）的认证 token
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- 配置 ----
const DAILY_LIMIT_PER_IP = Number(process.env.DAILY_LIMIT_PER_IP) || 5;
const DAILY_LIMIT_GLOBAL = Number(process.env.DAILY_LIMIT_GLOBAL) || 30;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

// ---- 频率限流（内存，防 burst）----
interface RateEntry { count: number; resetAt: number }
const rateStore = new Map<string, RateEntry>();
const RATE_RULES: Record<string, { limit: number; windowMs: number }> = {
  '/api/chat': { limit: 6, windowMs: 60_000 },
  '/api/upload': { limit: 2, windowMs: 60_000 },
  '/api/documents': { limit: 10, windowMs: 60_000 },
};

// ---- Supabase（用量持久化）----
const supabaseUrl = process.env.SUPABASE_URL ?? '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? '';
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
/**
 * 提取客户端真实 IP。
 * Vercel 在 X-Forwarded-For 末尾追加真实 IP，取最后一个值防止伪造。
 */
function getIP(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const ips = forwarded.split(',').map((s) => s.trim());
    return ips[ips.length - 1] || 'unknown'; // 取最后一个（Vercel 追加的真实 IP）
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function todayStart(): string {
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

let lastCleanup = 0;
function cleanupRate() {
  const now = Date.now();
  if (now - lastCleanup < 300_000) return;
  lastCleanup = now;
  for (const [key, entry] of rateStore) {
    if (now >= entry.resetAt) rateStore.delete(key);
  }
}

/**
 * 管理操作认证：upload 和 documents DELETE 需要 ADMIN_TOKEN。
 * 如果未配置 ADMIN_TOKEN，则禁止写操作（安全默认）。
 */
function checkAdminAuth(req: NextRequest): boolean {
  if (!ADMIN_TOKEN) return false; // 未配置 token = 禁止写操作
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

// ---- 每日配额检查 ----
async function checkDailyLimit(ip: string, route: string): Promise<{
  allowed: boolean;
  reason?: string;
  ipUsed?: number;
  globalUsed?: number;
}> {
  const db = getSupabase();
  // fail-closed：Supabase 不可用时拒绝请求，不放行
  if (!db) return { allowed: false, reason: '服务暂时不可用，请稍后再试' };

  const today = todayStart();

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

  if (globalUsed >= DAILY_LIMIT_GLOBAL) {
    return {
      allowed: false,
      reason: `今日体验名额已用完（${DAILY_LIMIT_GLOBAL} 次/天），明天再来试试吧`,
      ipUsed,
      globalUsed,
    };
  }

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

async function logUsage(ip: string, route: string) {
  const db = getSupabase();
  if (!db) return;
  await (db as any).from('usage_logs').insert({ ip, route });
}

// ---- 主 proxy ----
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isChat = pathname.startsWith('/api/chat');
  const isUpload = pathname.startsWith('/api/upload');
  const isDocuments = pathname.startsWith('/api/documents');
  if (!isChat && !isUpload && !isDocuments) return NextResponse.next();

  const route = isChat ? '/api/chat' : isUpload ? '/api/upload' : '/api/documents';
  const ip = getIP(req);

  // 管理操作认证（upload POST 和 documents DELETE 需要 ADMIN_TOKEN）
  if (isUpload && req.method === 'POST') {
    if (!checkAdminAuth(req)) {
      return NextResponse.json(
        { error: '需要管理员授权才能上传文档' },
        { status: 401 }
      );
    }
  }
  if (isDocuments && req.method === 'DELETE') {
    if (!checkAdminAuth(req)) {
      return NextResponse.json(
        { error: '需要管理员授权才能删除文档' },
        { status: 401 }
      );
    }
  }

  // 频率限流
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

  // 每日配额限流（仅 chat 计数）
  if (isChat) {
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
    logUsage(ip, route);
  }

  const res = NextResponse.next();
  res.headers.set('X-RateLimit-Route', route);
  return res;
}

export const config = {
  matcher: ['/api/chat/:path*', '/api/upload/:path*', '/api/documents/:path*'],
};
