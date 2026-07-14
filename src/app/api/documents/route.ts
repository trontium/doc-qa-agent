import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/documents — 返回已上传文档列表（按 source 分组）。
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('metadata')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;

    // 按 source 聚合
    const map = new Map<string, { source: string; chunks: number; uploadedAt: string }>();
    for (const row of data ?? []) {
      const meta = row.metadata as Record<string, unknown>;
      const source = (meta.source as string) ?? 'unknown';
      const uploadedAt = (meta.uploaded_at as string) ?? '';
      const prev = map.get(source);
      if (prev) {
        prev.chunks += 1;
      } else {
        map.set(source, { source, chunks: 1, uploadedAt });
      }
    }

    return NextResponse.json({ documents: [...map.values()] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/documents?source=xxx.pdf — 按 source 删除所有 chunks。
 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const source = url.searchParams.get('source');
    if (!source) return NextResponse.json({ error: 'source required' }, { status: 400 });

    const { error, count } = await supabase
      .from('documents')
      .delete({ count: 'exact' })
      .eq('metadata->>source', source);
    if (error) throw error;

    return NextResponse.json({ ok: true, deleted: count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
