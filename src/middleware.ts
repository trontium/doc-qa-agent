/**
 * Rate-limit middleware — IP 级限流保护
 *
 * 策略：
 *   /api/chat   → 10 次/分钟/IP
 *   /api/upload →  3 次/分钟/IP
 *   其他路由     → 不限流
 *
 * 实现方式：内存 Map（Vercel Serverless 每次冷启会重置，但在同一实例生命周期内有效）。
 * 如需跨实例持久限流，可换 Vercel KV (@vercel/kv) 或 Upstash。
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number; // timestamp ms
}

// 内存存储：ip → route → entry
const store = new Map<string, Map<string, RateLimitEntry>>();

const RULES: Record<string, { limit: number; windowMs: number }> = {
  '/api/chat': { limit: 10, windowMs: 60_000 },
  '/api/upload': { limit: 3, windowMs: 60_000 },
};

function getIP(req: NextRequest): string {
  // Vercel 把真实 IP 放在 x-forwarded-for 里
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function checkRateLimit(ip: string, route: string): { allowed: boolean; remaining: number; resetAt: number } {
  const rule = RULES[route];
  if (!rule) return { allowed: true, remaining: Infinity, resetAt: 0 };

  const now = Date.now();
  let ipMap = store.get(ip);
  if (!ipMap) {
    ipMap = new Map();
    store.set(ip, ipMap);
  }

  let entry = ipMap.get(route);
  if (!entry || now >= entry.resetAt) {
    // 新窗口
    entry = { count: 1, resetAt: now + rule.windowMs };
    ipMap.set(route, entry);
    return { allowed: true, remaining: rule.limit - 1, resetAt: entry.resetAt };
  }

  if (entry.count >= rule.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: rule.limit - entry.count, resetAt: entry.resetAt };
}

// 定期清理过期条目（每 5 分钟），防止内存泄漏
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 300_000) return;
  lastCleanup = now;
  for (const [ip, ipMap] of store) {
    for (const [route, entry] of ipMap) {
      if (now >= entry.resetAt) ipMap.delete(route);
    }
    if (ipMap.size === 0) store.delete(ip);
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 只对 API 路由做限流
  const matchedRoute = Object.keys(RULES).find((r) => pathname.startsWith(r));
  if (!matchedRoute) return NextResponse.next();

  cleanup();

  const ip = getIP(req);
  const { allowed, remaining, resetAt } = checkRateLimit(ip, matchedRoute);

  if (!allowed) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(RULES[matchedRoute].limit),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  const res = NextResponse.next();
  res.headers.set('X-RateLimit-Limit', String(RULES[matchedRoute].limit));
  res.headers.set('X-RateLimit-Remaining', String(remaining));
  return res;
}

export const config = {
  matcher: ['/api/chat/:path*', '/api/upload/:path*'],
};
