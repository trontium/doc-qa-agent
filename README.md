# 智能文档问答 Agent

> RAG + Function Calling + LangGraph 全栈开源 Agent。
> 覆盖 **文档上传 → 向量化入库 → 混合检索 → 工具编排 → 流式对话 → 引用溯源** 全链路。

**🎬 在线 Demo**：https://doc-qa-agent-six.vercel.app （首次上传约 5s、首字延迟约 1s）
**📦 GitHub**：https://github.com/trontium/doc-qa-agent

---

## ✨ 核心特性

| 模块 | 关键实现 |
|---|---|
| **多格式文档入库** | PDF (`pdf-parse@2` 类式 API) / Word (`mammoth`) / Markdown / TXT，递归切分（中文分隔符 `。！？`），800 字 chunk + 100 字 overlap |
| **向量化** | 智谱 GLM `embedding-3` · 1024 维 · 批量 64 · dimensions 参数指定 |
| **Hybrid Search** | 向量召回（pgvector HNSW + 余弦）+ 关键词召回（Postgres `ts_rank` BM25）并行拉取 top-10，**Reciprocal Rank Fusion** 融合排序取 top-5 |
| **LangGraph ReAct Agent** | `createReactAgent` + `MemorySaver` 多会话隔离，通过 `streamEvents(v2)` 输出结构化事件流 |
| **Function Calling 三工具** | `retrieve_docs`（RAG 检索）/ `web_search`（Tavily）/ `calculator`（math.js），全部用 Zod schema 约束参数 |
| **对话式 UI 工程化** | 5 态消息状态机（idle/streaming/done/error/aborted）+ `AbortController` 中断 + rAF 批量 flush + `React.memo` 消息组件隔离 |
| **引用溯源** | 回答内 `[1] [2]` 可点击 → 滚动到源片段卡片并高亮 1.5s |
| **流式渲染** | SSE 帧协议（tool_call → citations → content → [DONE]）+ Markdown 代码块 fenced 边界延迟高亮 |

---

## 🏗️ 架构

```
用户输入
   ↓
Next.js App Router 主页 (useChat hook · 5 态状态机)
   ↓ fetch stream
BFF (Next.js API Route · /api/chat · SSE · Node runtime)
   ↓ streamEvents(v2)
LangGraph createReactAgent (DeepSeek chat · MemorySaver)
   ├── retrieve_docs → Hybrid Search
   │        ├── 智谱 embedding-3 → pgvector match_docs (HNSW 余弦)
   │        └── Postgres keyword_docs (ts_rank BM25)
   │        └── Reciprocal Rank Fusion(k=60) 融合
   ├── web_search  → Tavily API
   └── calculator  → mathjs evaluate
   ↓ SSE
前端消费（rAF batch flush + Markdown 增量 + 引用 [n] 点击滚动高亮）
```

---

## 📁 目录结构

```
src/
├── app/
│   ├── page.tsx                  # 主页 · 侧边栏 + 对话
│   └── api/
│       ├── upload/route.ts       # 文档上传管道
│       ├── documents/route.ts    # 文档列表 / 删除
│       └── chat/route.ts         # SSE 流式对话（走 Agent）
├── components/
│   ├── ChatMessage.tsx           # 消息（memo + Markdown + 引用交互）
│   └── DocumentSidebar.tsx       # 侧边栏
├── hooks/
│   └── useChat.ts                # 5 态状态机 + rAF flush
├── lib/
│   ├── agent.ts                  # LangGraph createReactAgent
│   ├── tools.ts                  # 3 个 Function Calling 工具
│   ├── rag.ts                    # Hybrid Search + RRF
│   ├── deepseek.ts               # DeepSeek 兼容层
│   ├── embedding.ts              # 智谱 embedding-3 客户端
│   ├── splitter.ts               # 递归切分
│   └── supabase.ts               # service_role 客户端
├── store/
│   └── chatStore.ts              # Zustand
└── types/
    └── message.ts                # Message / Citation / ToolCall
```

---

## 🚀 本地开发

### 前置
- Node 20+, pnpm 10+
- 账号：Supabase / DeepSeek / 智谱 AI / Tavily

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
```

### 数据库初始化
在 Supabase SQL Editor 执行 [`docs/schema.sql`](./docs/schema.sql)（含 `documents` / `conversations` 表 + HNSW / BM25 索引 + `match_docs` / `keyword_docs` RPC）。

---

## 💡 使用场景

| 场景 | 输入示例 | Agent 行为 |
|---|---|---|
| **文档问答** | 上传 PDF 后问 "XX 的原理是什么？" | 📚 检索知识库 → 带 `[1] [2]` 引用回答 |
| **实时信息** | "今天深圳天气怎么样？" | 🌐 搜索互联网（Tavily） |
| **数学运算** | "帮我算 (3+4)*5" | 🧮 计算器 → 35 |

---

## 🎯 核心工程亮点（面试用）

### 1. Hybrid Search + RRF 融合
纯向量检索在 **字面不匹配但语义相关** 场景下（专有名词、代码片段、缩写）召回率不够。生产 RAG 都是混合检索：
- 向量召回（pgvector `<=>` 余弦）top-10
- BM25 关键词召回（Postgres `ts_rank`）top-10
- RRF 融合：`score(d) = Σ 1 / (k + rank_i(d))`，k=60，去重排序取 top-5

### 2. Function Calling 五步流程
1. 声明工具（`tool()` + Zod schema + description）
2. LLM 决策：返回 `tool_calls: [{name, args}]`
3. Agent 执行工具
4. 工具结果作为 `role: 'tool'` 消息回传
5. LLM 组织最终答复

失败时错误塞回 tool_response 让 LLM 决定重试或告知用户；`recursionLimit=10` 防死循环。

### 3. 流式渲染工程化
- **SSE 帧协议**：`tool_call` → `citations` → `content`（多条）→ `[DONE]`
- **buffer 拼接**：`TextDecoder({stream:true})` 防跨 chunk 中文乱码
- **rAF 批量 flush**：累积 chunk 到 `ref`，`requestAnimationFrame` 触发 flush，避免每 token setState 引起 diff 风暴
- **React.memo**：消息组件独立 memo，propsAreEqual 只比 `content/status/citations/toolCalls` 四字段
- **组件外定义 plugins**：`REMARK_PLUGINS` / `REHYPE_PLUGINS` 常量化，避免 memo 被新引用破坏

### 4. 引用可解释性
回答里 `[1] [2]` 用正则 `/\[(\d{1,2})\]/g` 匹配 → 转成 `<button>` → 点击滚动到对应引用卡片 + 高亮 1.5s。

### 5. 上下文预算控制
- 智谱 embedding 批量 64 减少调用次数
- 前端只把 `status === 'done'` 的历史消息作为上下文（避免误传流式中间态）
- LLM 温度 0 保证一致性

---

## 📚 对齐资料

- [Agent & LLM 面试宝典](../.workbuddy/memory/2026-07-13.md)（§4 RAG、§5 Function Calling、§8 LangGraph、§9 对话式 UI）
- [LangGraph 官方文档](https://langchain-ai.github.io/langgraphjs/)
- [Supabase pgvector 官方指南](https://supabase.com/docs/guides/ai/vector-columns)

---

## 📝 License

MIT
