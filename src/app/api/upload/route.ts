import { NextRequest, NextResponse } from 'next/server';
import { embedMany } from '@/lib/embedding';
import { splitText } from '@/lib/splitter';
import { supabase } from '@/lib/supabase';

// Node runtime（pdf-parse 需要 Buffer / Node stream）
export const runtime = 'nodejs';
export const maxDuration = 60;

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

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 });

    // 1. 解析文件为纯文本
    const text = await parseFile(file);
    if (!text.trim()) {
      return NextResponse.json({ error: 'empty file' }, { status: 400 });
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
