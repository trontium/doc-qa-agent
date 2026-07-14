# 智能文档问答 Agent

RAG + Function Calling + LangGraph 全栈 Agent。

**技术栈**：Next.js 15 App Router · TypeScript · Tailwind v4 · shadcn/ui · Zustand · LangChain.js · LangGraph.js · pgvector · Supabase · SSE

## 功能（迭代中）

- [x] Next.js 骨架 + shadcn/ui + Zustand 消息状态机
- [ ] 文档上传 + pgvector 向量化入库
- [ ] Hybrid Search 混合检索（向量 + BM25 + RRF）
- [ ] SSE 流式对话（rAF 批量 flush + 代码块延迟高亮）
- [ ] LangGraph createReactAgent + Function Calling 三工具
- [ ] 引用溯源高亮

## 本地开发

```bash
pnpm install
cp .env.local.example .env.local  # 填入你的 API keys
pnpm dev
```

访问 http://localhost:3000

## 环境变量

见 `.env.local.example`。需要：
- **DeepSeek** API key（chat 模型）
- **智谱 AI** API key（embedding 模型 · 1024 维）
- **Supabase** URL 和 Service Key（数据库 + pgvector）
- **Tavily** API key（Web 搜索工具）

## 数据库

在 Supabase SQL Editor 执行：

```sql
create extension if not exists vector;

create table documents (
  id bigserial primary key,
  content text not null,
  metadata jsonb default '{}'::jsonb,
  embedding vector(1024),
  content_tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz default now()
);

create index documents_embedding_idx on documents using hnsw (embedding vector_cosine_ops);
create index documents_content_tsv_idx on documents using gin (content_tsv);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null unique,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```
