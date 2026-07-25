import { NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * GET /api/health — 健康检查端点
 * 仅返回 status + timestamp，不暴露内部配置细节
 */
export async function GET() {
  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasZhipu = !!process.env.ZHIPU_API_KEY;

  const ok = hasSupabase && hasDeepSeek && hasZhipu;

  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', timestamp: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  );
}
