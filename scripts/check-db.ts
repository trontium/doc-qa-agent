/**
 * 检查数据库状态
 * 运行：DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/check-db.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_KEY!;

if (!url || !key) {
  console.error('SUPABASE_URL 或 SUPABASE_SERVICE_KEY 未设置');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data, count } = await supabase
    .from('documents')
    .select('id, content, metadata', { count: 'exact' })
    .limit(5);

  console.log(`数据库中共 ${count} 条文档记录\n`);

  if (data) {
    for (const d of data) {
      console.log(`--- ID: ${d.id} ---`);
      console.log(`来源: ${(d.metadata as Record<string, unknown>)?.source ?? '未知'}`);
      console.log(`内容前 200 字: ${(d.content as string).slice(0, 200)}`);
      console.log();
    }
  }

  // 测试一下关键词搜索
  const { data: kwData } = await supabase.rpc('keyword_docs', {
    query: 'Hybrid Search',
    match_count: 3,
  });
  console.log('关键词搜索 "Hybrid Search" 结果:', kwData?.length ?? 0, '条');

  // 测试向量搜索
  const { embed } = await import('../src/lib/embedding');
  const queryEmb = await embed('Hybrid Search 的原理');
  const { data: vecData } = await supabase.rpc('match_docs', {
    query_embedding: queryEmb,
    match_count: 3,
  });
  console.log('向量搜索 "Hybrid Search 的原理" 结果:', vecData?.length ?? 0, '条');
  if (vecData?.length) {
    console.log('第一条内容前 200 字:', (vecData[0] as { content: string }).content.slice(0, 200));
  }
}

main().catch(console.error);
