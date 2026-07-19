/**
 * LangGraph ReAct Agent — 支持 MCP 工具动态发现
 *
 * 架构决策：
 *   - 默认使用硬编码工具（无需 MCP，部署兼容）
 *   - 设置 ENABLE_MCP=true 时，从 MCP Server 动态获取工具
 *   - Vercel 部署时 MCP 不可用（无法 spawn 子进程），自动降级为硬编码工具
 *   - 两种模式共享同一个 agent 结构，工具来源对上层透明
 */

import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { tools as hardcodedTools } from './tools';

const llm = new ChatOpenAI({
  model: 'deepseek-chat',
  temperature: 0,
  streaming: true,
  configuration: {
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY,
  },
});

const checkpointer = new MemorySaver();

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

// 默认 agent（硬编码工具，始终可用）
export const agent = createReactAgent({
  llm,
  tools: hardcodedTools,
  checkpointer,
  prompt: SYSTEM_PROMPT,
});

/**
 * 获取 MCP Agent（动态工具发现模式）
 * 仅在 ENABLE_MCP=true 时调用
 */
let mcpAgentPromise: ReturnType<typeof createReactAgent> | null = null;

export async function getAgent() {
  if (process.env.ENABLE_MCP !== 'true') return agent;

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
