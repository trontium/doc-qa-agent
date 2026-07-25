import { NextRequest, NextResponse } from 'next/server';
import { embedMany } from '@/lib/embedding';
import { splitText } from '@/lib/splitter';
import { supabase } from '@/lib/supabase';

// Node runtime（pdf-parse 需要 Buffer / Node stream）
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_TOTAL_DOCS = 20;  // 最多 20 个文档（按 source 分组计数，不是 chunk 数）
const MAX_TOTAL_CHUNKS = 2000; // chunk 硬上限（防止向量搜索变慢）

async function parseFile(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) {
    // pdf-parse 2.x：class API（不再是默认导出函数）
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    return result.text;
  }
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (name.endsWith('.md') || name.endsWith('.txt')) {
    return buf.toString('utf-8');
  }
  throw new Error(`unsupported file type: ${file.name}`);
}

/**
 * 检测 PDF 解析失败产物：\u00000c/uni00000055/... 这种格式
 * pdfjs 在 ToUnicode CMap 缺失时输出原始字符编码
 */
function isGarbageText(text: string): boolean {
  if (!text) return true;
  const sample = text.slice(0, 2000);
  const uniCount = (sample.match(/uni\d{6}/g) ?? []).length;
  const escapeCount = (sample.match(/\\u[0-9a-fA-F]{4}/g) ?? []).length;
  if (uniCount > 5 || escapeCount > 5) return true;
  // 几乎全部是非打印字符
  const printable = sample.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, '').length;
  if (sample.length > 100 && printable / sample.length < 0.3) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 });

    // 文件大小限制
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），上限 5MB。建议拆分或压缩后重新上传`,
      }, { status: 413 });
    }

    // 文档数限制（按 source 分组计数，不是 chunk 行数）
    const { data: allMeta } = await supabase
      .from('documents')
      .select('metadata')
      .limit(10000);
    const uniqueSources = new Set(
      (allMeta ?? []).map((r) => {
        const s = (r.metadata as Record<string, unknown>)?.source;
        return typeof s === 'string' && s ? s : '__orphan__';
      })
    );
    if (uniqueSources.size >= MAX_TOTAL_DOCS) {
      return NextResponse.json({
        error: `知识库已满（${MAX_TOTAL_DOCS} 个文档上限），请先删除旧文档再上传`,
      }, { status: 413 });
    }

    // chunk 总数硬上限
    const { count: chunkCount } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true });
    if ((chunkCount ?? 0) >= MAX_TOTAL_CHUNKS) {
      return NextResponse.json({
        error: `知识库 chunk 数已达上限（${MAX_TOTAL_CHUNKS}），请先删除旧文档`,
      }, { status: 413 });
    }

    // 1. 解析文件为纯文本
    const text = await parseFile(file);
    if (!text.trim()) {
      return NextResponse.json({ error: 'empty file' }, { status: 400 });
    }

    // 1.5 检测 PDF 解析失败（输出是 unicode 转义字符）
    if (isGarbageText(text)) {
      return NextResponse.json({
        error:
          'PDF 解析失败：可能是扫描件或字体编码缺失。建议：① 用其他 PDF 提取工具（pdftotext / Adobe）转一遍；② 或转成 Markdown/TXT 上传',
      }, { status: 400 });
    }

    // 2. 递归切分（中文分隔符友好）
    const chunks = splitText(text, { chunkSize: 800, chunkOverlap: 100 });
    if (chunks.length === 0) {
      return NextResponse.json({ error: 'no chunks after splitting' }, { status: 400 });
    }

    // 3. 智谱 embedding-3 批量向量化（1024 维）
    const vectors = await embedMany(chunks);

    // 4. 存入 Supabase
    const rows = chunks.map((content, i) => ({
      content,
      embedding: vectors[i],
      metadata: {
        source: file.name,
        chunk_index: i,
        total_chunks: chunks.length,
        uploaded_at: new Date().toISOString(),
      },
    }));

    const { error } = await supabase.from('documents').insert(rows);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      source: file.name,
      chunks: chunks.length,
      totalChars: text.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[upload] error:', msg);
    // 不向客户端泄露内部错误详情
    return NextResponse.json({ error: '文件处理失败，请稍后重试' }, { status: 500 });
  }
}
