/**
 * LLM 实例 — 全局共享，避免 agent.ts / retriever.ts 各自创建导致循环依赖
 *
 * 模型：DeepSeek V4 Flash（deepseek-chat 于 2026/07/24 弃用，改为 v4-flash）
 * temperature: 0 — 工具调用和查询改写场景不需要随机性
 * maxTokens: 2048 — 成本控制，单次回复不超过 ~2K token
 * maxRetries: 2 — API 偶发 429/503 时自动重试
 */

import { ChatOpenAI } from '@langchain/openai';

export const llm = new ChatOpenAI({
  model: 'deepseek-v4-flash',
  temperature: 0,
  streaming: true,
  maxTokens: 2048,
  maxRetries: 2,
  configuration: {
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY,
  },
});
