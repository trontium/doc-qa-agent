import { NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * GET /api/health — 健康检查端点
 * Vercel / 监控系统用，确认服务可用
 */
export async function GET() {
  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasZhipu = !!process.env.ZHIPU_API_KEY;

  const allRequired = hasSupabase && hasDeepSeek && hasZhipu;

  return NextResponse.json(
    {
      status: allRequired ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        supabase: hasSupabase,
        deepseek: hasDeepSeek,
        zhipu: hasZhipu,
        tavily: !!process.env.TAVILY_API_KEY,
        reranker: !!process.env.SILICONFLOW_API_KEY,
      },
    },
    { status: allRequired ? 200 : 503 }
  );
}
