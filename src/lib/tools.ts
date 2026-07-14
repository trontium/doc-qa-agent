/**
 * 三个 Function Calling 工具
 *  · retrieve_docs · 走 Day 3 的 Hybrid Search（RAG 检索作为工具）
 *  · web_search   · Tavily API 实时联网
 *  · calculator   · mathjs 计算器
 *
 * 对齐 Agent 宝典 §5.1 · Function Calling 五步流程
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { evaluate } from 'mathjs';
import { hybridSearch } from './rag';

// ---------- Tool 1 · RAG 检索 ----------
export const retrieveDocs = tool(
  async ({ query }: { query: string }) => {
    const docs = await hybridSearch(query, 5);
    if (!docs.length) return '知识库中未检索到相关内容。';
    return docs
      .map(
        (d, i) =>
          `[${i + 1}] (来源：${(d.metadata as { source?: string } | null)?.source ?? '未知'})\n${d.content}`
      )
      .join('\n\n---\n\n');
  },
  {
    name: 'retrieve_docs',
    description:
      '当用户询问已上传知识库中文档的内容、概念、定义时使用此工具进行混合检索（向量+BM25+RRF融合）。返回相关段落及来源标注。',
    schema: z.object({
      query: z.string().describe('检索关键词，尽可能精炼（例如"RRF 公式"、"Hybrid Search 原理"）'),
    }),
  }
);

// ---------- Tool 2 · Web 搜索 ----------
export const webSearch = tool(
  async ({ query }: { query: string }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return 'Web 搜索不可用（TAVILY_API_KEY 未配置）。';
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: 3,
          search_depth: 'basic',
        }),
      });
      if (!res.ok) return `Web 搜索失败：${res.status}`;
      const data = (await res.json()) as {
        results?: { title: string; url: string; content: string }[];
      };
      if (!data.results?.length) return 'Web 搜索未返回结果。';
      return data.results
        .map(
          (r, i) => `[Web-${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 300)}`
        )
        .join('\n\n---\n\n');
    } catch (e) {
      return `Web 搜索异常：${(e as Error).message}`;
    }
  },
  {
    name: 'web_search',
    description:
      '当用户询问实时信息、新闻、天气、汇率、无法从知识库中获取的问题时使用此工具搜索互联网。',
    schema: z.object({
      query: z.string().describe('搜索关键词'),
    }),
  }
);

// ---------- Tool 3 · 计算器 ----------
export const calculator = tool(
  async ({ expression }: { expression: string }) => {
    try {
      const result = evaluate(expression);
      return String(result);
    } catch (e) {
      return `计算错误：${(e as Error).message}`;
    }
  },
  {
    name: 'calculator',
    description:
      '执行数学运算，支持四则运算/开方/幂运算/三角函数等。示例：(3+4)*5、sqrt(144)、sin(pi/2)。',
    schema: z.object({
      expression: z.string().describe('数学表达式，如 "(3+4)*5" 或 "sqrt(144)"'),
    }),
  }
);

export const tools = [retrieveDocs, webSearch, calculator];
