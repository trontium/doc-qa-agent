-- =====================================================
-- 智能文档问答 Agent · Supabase Schema
-- 在 Supabase SQL Editor 依次执行
-- =====================================================

-- 1. 启用 pgvector 扩展
create extension if not exists vector;

-- 2. 文档表（向量 1024 维对应智谱 embedding-3 · dimensions=1024）
create table if not exists documents (
  id bigserial primary key,
  content text not null,
  metadata jsonb default '{}'::jsonb,
  embedding vector(1024),
  content_tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz default now()
);

-- 3. HNSW 向量索引（余弦相似度）
create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);

-- 4. BM25 全文检索索引
create index if not exists documents_content_tsv_idx
  on documents using gin (content_tsv);

-- 5. 会话表（LangGraph MemorySaver 可用）
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null unique,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =====================================================
-- 6. RPC · 向量检索（余弦相似度）
-- =====================================================
create or replace function match_docs(
  query_embedding vector(1024),
  match_count int default 10
)
returns table(
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select id, content, metadata,
         1 - (embedding <=> query_embedding) as similarity
  from documents
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- =====================================================
-- 8. 用量统计表（限流 + 预算保护）
-- =====================================================
create table if not exists usage_logs (
  id bigserial primary key,
  ip text not null,
  route text not null,
  created_at timestamptz default now()
);

-- 按天+IP 查询次数的索引（限流查询用）
create index if not exists usage_logs_daily_idx
  on usage_logs (route, ip, created_at);

-- 自动清理 7 天前的日志（保持表小）
-- 需在 Supabase → Database → Cron 里配 pg_cron 每天跑：
-- SELECT count(*) FROM usage_logs WHERE created_at < now() - interval '7 days';
-- =====================================================
create or replace function keyword_docs(
  query text,
  match_count int default 10
)
returns table(
  id bigint,
  content text,
  metadata jsonb,
  rank real
)
language sql stable
as $$
  select id, content, metadata,
         ts_rank(content_tsv, plainto_tsquery('simple', query)) as rank
  from documents
  where content_tsv @@ plainto_tsquery('simple', query)
  order by rank desc
  limit match_count;
$$;
