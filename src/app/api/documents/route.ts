import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/documents — 返回已上传文档列表（按 source 分组）。
 * 孤儿文档（metadata->>source 为 null）会被独立分组，标为 "(无 source · 孤儿文档)"。
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('metadata')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;

    // 按真实 source 聚合（不做归一化，区分"是某个值"和"真的没有"）
    const map = new Map<string, { source: string; chunks: number; uploadedAt: string }>();
    for (const row of data ?? []) {
      const meta = row.metadata as Record<string, unknown> | null;
      const rawSource = meta?.source;
      const source = typeof rawSource === 'string' && rawSource ? rawSource : '__null_source__';
      const uploadedAt = (meta?.uploaded_at as string) ?? '';
      const prev = map.get(source);
      if (prev) {
        prev.chunks += 1;
      } else {
        map.set(source, { source, chunks: 1, uploadedAt });
      }
    }

    // 前端展示时把 __null_source__ 映射成 (无 source · 孤儿文档)
    const documents = [...map.values()].map((d) => ({
      ...d,
      displaySource: d.source === '__null_source__' ? '(无 source · 孤儿文档)' : d.source,
    }));

    return NextResponse.json({ documents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/documents?source=xxx.pdf — 按 source 删除所有 chunks。
 * 特殊值：source=__null__ 删除所有 metadata->>source 为 null 或缺失的孤儿文档。
 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const source = url.searchParams.get('source');
    if (!source) return NextResponse.json({ error: 'source required' }, { status: 400 });

    let query = supabase.from('documents').delete({ count: 'exact' });

    if (source === '__null__' || source === '__null_source__') {
      // 删除孤儿文档：metadata->>source 为 null 或空字符串
      query = query.or('metadata->>source.is.null,metadata->>source.eq.');
    } else {
      query = query.eq('metadata->>source', source);
    }

    const { error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ ok: true, deleted: count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
