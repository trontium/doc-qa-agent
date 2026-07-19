/**
 * MCP Server — 将现有 3 个工具暴露为 MCP 协议
 *
 * 这个 Server 把 retrieve_docs / web_search / calculator 包装成 MCP 工具，
 * 供 MCP Client 动态发现和调用。
 *
 * 运行方式：npx tsx src/mcp/server.ts
 * Client 通过 StdioClientTransport 连接：new StdioClientTransport({ command: "npx", args: ["tsx", "src/mcp/server.ts"] })
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { hybridSearch } from '../lib/rag';
import { evaluate } from 'mathjs';

const server = new McpServer({
  name: 'doc-qa-tools',
  version: '1.0.0',
});

// Tool 1: RAG 检索
server.tool(
  'retrieve_docs',
  '当用户询问已上传知识库中文档的内容、概念、定义时使用此工具进行混合检索（向量+BM25+RRF融合+Rerank精排）。返回相关段落及来源标注。',
  { query: z.string().describe('检索关键词，尽可能精炼') },
  async ({ query }) => {
    const docs = await hybridSearch(query, 5);
    if (!docs.length) return { content: [{ type: 'text' as const, text: '知识库中未检索到相关内容。' }] };
    const text = docs
      .map(
        (d, i) =>
          `[${i + 1}] (来源：${(d.metadata as { source?: string } | null)?.source ?? '未知'})\n${d.content}`
      )
      .join('\n\n---\n\n');
    return { content: [{ type: 'text' as const, text }] };
  }
);

// Tool 2: Web 搜索
server.tool(
  'web_search',
  '当用户询问实时信息、新闻、天气、汇率、无法从知识库中获取的问题时使用此工具搜索互联网。',
  { query: z.string().describe('搜索关键词') },
  async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return { content: [{ type: 'text' as const, text: 'Web 搜索不可用（TAVILY_API_KEY 未配置）。' }] };
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, max_results: 3, search_depth: 'basic' }),
      });
      if (!res.ok) return { content: [{ type: 'text' as const, text: `Web 搜索失败：${res.status}` }] };
      const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
      if (!data.results?.length) return { content: [{ type: 'text' as const, text: 'Web 搜索未返回结果。' }] };
      const text = data.results
        .map((r, i) => `[Web-${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 300)}`)
        .join('\n\n---\n\n');
      return { content: [{ type: 'text' as const, text }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `Web 搜索异常：${(e as Error).message}` }] };
    }
  }
);

// Tool 3: 计算器
server.tool(
  'calculator',
  '执行数学运算，支持四则运算/开方/幂运算/三角函数等。示例：(3+4)*5、sqrt(144)、sin(pi/2)。',
  { expression: z.string().describe('数学表达式') },
  async ({ expression }) => {
    try {
      const result = evaluate(expression);
      return { content: [{ type: 'text' as const, text: String(result) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `计算错误：${(e as Error).message}` }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-server] doc-qa-tools MCP Server running on stdio');
}

main().catch(console.error);
