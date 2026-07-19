/**
 * Agent 管理 — 支持 3 种模式
 *
 * 1. 默认模式（单 Agent + 硬编码工具）— 生产环境
 * 2. Pipeline 模式（2-Stage: Retriever → Generator）— 生产环境，解耦检索与生成
 * 3. MCP 模式（单 Agent + 动态工具发现）— 本地开发
 *
 * 架构决策：
 *   - Pipeline 模式：检索是确定性管道，不需要 Agent 决策"要不要检索"，
 *     拆开后检索 prompt 专注查询优化，生成 prompt 专注回答质量
 *   - MCP 模式：通过 ENABLE_MCP=true 开启，STDIO 传输，Serverless 自动降级
 *   - 三种模式共享 LLM 实例和 checkpointer
 */

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { llm } from './llm';
import { tools as hardcodedTools } from './tools';

const checkpointer = new MemorySaver();

// ---------- System Prompts ----------

const SYSTEM_PROMPT = `你是一个专业助手，可以调用工具帮助回答问题。

工具选择原则：
- 涉及知识库内文档的问题（概念、定义、公式、原理），优先调用 retrieve_docs
- 涉及实时信息（新闻、天气、汇率），调用 web_search
- 涉及数学计算（含精确的四则运算），调用 calculator
- 如果不需要工具能直接回答，就直接回答

回答规范：
- 使用 retrieve_docs 后，回答时用 [1] [2] 引用对应段落
- 使用 web_search 后，注明来源 URL
- 使用 calculator 后，直接给出结果
- 如果知识库/网络中都没有答案，说"我没有找到相关信息"，不要编造`;

/**
 * Stage 2 的 System Prompt — 基于检索上下文组织回答
 * 和通用 prompt 的区别：不需要 retrieve_docs（Stage 1 已完成检索）
 */
const PIPELINE_GENERATOR_PROMPT = `你是一个专业助手。检索阶段已经为你找到了相关文档内容，你需要基于这些内容组织回答。

回答规范：
- 严格基于检索到的上下文回答，用 [1] [2] 引用对应段落
- 如果上下文不足以回答问题，说"我没有找到相关信息"，不要编造
- 如果用户问的是数学计算，使用 calculator 工具
- 如果用户问的是实时信息（新闻、天气、汇率），使用 web_search 工具
- 回答要简洁准确，不要重复上下文中的大段原文`;

// ---------- Agent 1: 默认（单 Agent + 硬编码工具）----------

export const agent = createReactAgent({
  llm,
  tools: hardcodedTools,
  checkpointer,
  prompt: SYSTEM_PROMPT,
});

// ---------- Agent 2: Pipeline Generator（Stage 2）----------

const generatorTools = hardcodedTools.filter(
  (t) => t.name !== 'retrieve_docs'
);

const pipelineGenerator = createReactAgent({
  llm,
  tools: generatorTools,
  checkpointer,
  prompt: PIPELINE_GENERATOR_PROMPT,
});

// ---------- MCP Agent（动态工具发现）----------

let mcpAgentPromise: ReturnType<typeof createReactAgent> | null = null;

async function getMCPAgent() {
  if (!mcpAgentPromise) {
    mcpAgentPromise = (async () => {
      try {
        const { getMCPTools, connectMCP } = await import('./mcp-client');
        const connected = await connectMCP();
        if (connected) {
          const mcpTools = await getMCPTools();
          if (mcpTools.length > 0) {
            console.log(`[agent] MCP mode: using ${mcpTools.length} dynamically discovered tools`);
            return createReactAgent({
              llm,
              tools: mcpTools as unknown as typeof hardcodedTools,
              checkpointer,
              prompt: SYSTEM_PROMPT,
            });
          }
        }
      } catch (e) {
        console.warn('[agent] MCP unavailable, using hardcoded tools:', (e as Error).message);
      }
      return agent;
    })();
  }
  return mcpAgentPromise;
}

// ---------- 对外接口 ----------

/**
 * 获取当前模式下的 Agent
 *
 * 优先级：
 *   1. ENABLE_MCP=true → MCP Agent（动态工具发现）
 *   2. 默认 → 单 Agent + 硬编码工具
 */
export async function getAgent() {
  if (process.env.ENABLE_MCP === 'true') return getMCPAgent();
  return agent;
}

/**
 * 获取 Pipeline Generator Agent（Stage 2）
 * 只保留 calculator + web_search，不含 retrieve_docs
 */
export function getPipelineGenerator() {
  return pipelineGenerator;
}
