# 流式对话 + 混合检索全栈 Agent

> RAG + Function Calling + LangGraph 全栈开源 Agent。
> 覆盖 **文档上传 → 向量化入库 → 混合检索 → 2-Stage 管道 → 流式对话 → 引用溯源** 全链路。

**Demo**: https://doc-qa-agent-six.vercel.app
**GitHub**: https://github.com/trontium/doc-qa-agent

---

## 核心特性

| 模块 | 关键实现 |
|---|---|
| **多格式文档入库** | PDF / Word / Markdown / TXT，递归切分（中文分隔符），800 字 chunk + 100 字 overlap |
| **Hybrid Search + Rerank** | 向量召回（pgvector HNSW）+ 关键词召回（Postgres BM25）→ RRF 融合 → Cross-Encoder 精排（bge-reranker-v2-m3）|
| **2-Stage Pipeline** | Stage 1 确定性检索管道（查询改写 + 混合检索 + Rerank）→ Stage 2 Agent 生成（calculator + web_search）|
| **LangGraph ReAct Agent** | `createReactAgent` + `MemorySaver` 多会话隔离，`streamEvents(v2)` 结构化事件流 |
| **MCP Client** | STDIO 传输动态工具发现，Serverless 自动降级为硬编码工具 |
| **流式渲染工程化** | 5 态消息状态机 + rAF 批量 flush + React.memo + SSE 帧协议 |
| **引用溯源** | 回答内 `[1] [2]` 可点击 → 滚动到源片段卡片并高亮 |
| **检索评估** | 60 条查询 × 3 策略对比，Top-5 命中率 88%，MRR 0.82 |

---

## 架构

```
用户输入
   ↓
Next.js App Router (useChat hook · 5 态状态机)
   ↓ fetch stream
BFF (/api/chat · SSE · 2-Stage Pipeline)
   ↓
Stage 1: 确定性检索管道
   ├── LLM 查询改写 (口语化 → 检索词)
   ├── Hybrid Search
   │     ├── 智谱 embedding-3 → pgvector (HNSW 余弦)
   │     └── Postgres keyword_docs (ts_rank BM25)
   │     └── RRF(k=60) 融合
   └── Cross-Encoder Rerank (bge-reranker-v2-m3)
   ↓ 结构化上下文
Stage 2: LangGraph ReAct Agent
   ├── calculator (mathjs)
   └── web_search (Tavily)
   ↓ SSE
前端消费 (rAF batch flush + Markdown + 引用交互)
```

---

## 目录结构

```
src/
├── app/
│   ├── page.tsx                  # 主页 · 侧边栏 + 对话
│   └── api/
│       ├── upload/route.ts       # 文档上传管道
│       ├── documents/route.ts    # 文档列表 / 删除
│       └── chat/route.ts         # 2-Stage SSE 流式对话
├── components/
│   ├── ChatMessage.tsx           # 消息 (memo + Markdown + 引用 + 阶段指示)
│   ├── ToolCallDetail.tsx        # 工具调用可视化
│   └── DocumentSidebar.tsx       # 侧边栏
├── hooks/
│   └── useChat.ts                # 5 态状态机 + rAF flush + stage 解析
├── lib/
│   ├── agent.ts                  # 3 模式 Agent (默认 / Pipeline / MCP)
│   ├── retriever.ts              # Stage 1: 查询改写 + 混合检索 + Rerank
│   ├── llm.ts                    # 共享 LLM 实例 (避免循环依赖)
│   ├── tools.ts                  # Function Calling 工具
│   ├── rag.ts                    # Hybrid Search + RRF
│   ├── reranker.ts               # Cross-Encoder 精排 (SiliconFlow)
│   ├── mcp-client.ts             # MCP Client (STDIO)
│   ├── embedding.ts              # 智谱 embedding-3
│   ├── splitter.ts               # 递归切分
│   └── supabase.ts               # service_role 客户端
├── store/
│   └── chatStore.ts              # Zustand
└── types/
    └── message.ts                # Message / Citation / ToolCall / StageStatus
scripts/
├── eval.ts                       # 检索管道评估 (Top-K 命中率 + MRR)
├── eval-queries.json             # 60 条评估查询集
└── upload-pdfs.py                # 批量 PDF 上传脚本
```

---

## 本地开发

### 前置
- Node 20+, pnpm 10+
- 账号：Supabase / DeepSeek / 智谱 AI / Tavily / SiliconFlow

### 启动
```bash
pnpm install
cp .env.local.example .env.local  # 填入你的 API keys
pnpm dev
```
访问 http://localhost:3000

### 环境变量（`.env.local`）
```
DEEPSEEK_API_KEY=sk-...
ZHIPU_API_KEY=xxx.yyy
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_...
TAVILY_API_KEY=tvly-...
SILICONFLOW_API_KEY=sk-...     # Rerank (可选，无则降级)
ENABLE_PIPELINE=true            # 2-Stage Pipeline (默认开启)
ENABLE_MCP=false                # MCP 模式 (默认关闭)
```

### 数据库初始化
在 Supabase SQL Editor 执行 [`docs/schema.sql`](./docs/schema.sql)（含 `documents` 表 + HNSW / BM25 索引 + `match_docs` / `keyword_docs` RPC）。

---

## 检索评估

基于 60 条查询、1877 chunks 的评估结果：

| 策略 | Top-3 命中率 | Top-5 命中率 | MRR |
|------|------------|------------|-----|
| 纯向量检索 | 83.3% | 85.0% | 0.774 |
| 混合检索 + RRF | 83.3% | 85.0% | 0.774 |
| 混合检索 + RRF + Rerank | 83.3% | **88.3%** | **0.816** |

Rerank 精排带来 Top-5 命中率 +3.3%，MRR 排序质量 +5.4%。

---

## 使用场景

| 场景 | 输入示例 | Agent 行为 |
|---|---|---|
| **文档问答** | 上传 PDF 后问 "XX 的原理是什么？" | 检索知识库 → 带 `[1] [2]` 引用回答 |
| **实时信息** | "今天深圳天气怎么样？" | 搜索互联网（Tavily） |
| **数学运算** | "帮我算 (3+4)*5" | 计算器 → 35 |

---

## License

MIT
