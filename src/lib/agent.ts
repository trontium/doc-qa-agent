/**
 * LangGraph ReAct Agent
 *  · createReactAgent（宝典 §8.1）
 *  · MemorySaver 多会话隔离（thread_id）
 *  · DeepSeek 通过 ChatOpenAI 兼容层接入
 */

import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { tools } from './tools';

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

export const agent = createReactAgent({
  llm,
  tools,
  checkpointer,
  prompt: SYSTEM_PROMPT,
});
