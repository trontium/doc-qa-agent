/**
 * MCP Client 适配层 — 从 MCP Server 动态发现工具，桥接到 LangChain Tool
 *
 * 架构：
 *   MCP Server (src/mcp/server.ts) ← STDIO → MCP Client (本文件)
 *                                             ↓ listTools()
 *                                       获取工具 JSON Schema
 *                                             ↓ 适配
 *                                       LangChain DynamicStructuredTool
 *                                             ↓
 *                                       createReactAgent({ tools })
 *
 * 关键工程决策：
 *   - STDIO transport：本地开发最简单，直接 spawn 子进程
 *   - Vercel 部署兼容：serverless 不允许 spawn 子进程，自动降级为硬编码工具
 *   - JSON Schema → Zod 转换：MCP 用 JSON Schema 定义参数，LangChain 用 Zod
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { tools as hardcodedTools } from './tools';

let mcpClient: Client | null = null;
let mcpConnected = false;

/**
 * 初始化 MCP Client 并连接到 Server
 * @returns 是否连接成功
 */
export async function connectMCP(): Promise<boolean> {
  try {
    mcpClient = new Client({
      name: 'doc-qa-agent',
      version: '1.0.0',
    });

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/mcp/server.ts'],
    });

    await mcpClient.connect(transport);
    mcpConnected = true;
    console.log('[mcp-client] Connected to MCP Server');
    return true;
  } catch (e) {
    console.warn('[mcp-client] Failed to connect, falling back to hardcoded tools:', (e as Error).message);
    mcpConnected = false;
    mcpClient = null;
    return false;
  }
}

/**
 * 将 JSON Schema 转换为 Zod Schema（简化版，支持 string/number/boolean/array/object）
 * MCP 工具用 JSON Schema 定义参数，LangChain 用 Zod，需要转换。
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || !schema.type) return z.object({});

  const type = schema.type as string;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;

  if (type === 'object' && properties) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(properties)) {
      let field: z.ZodTypeAny;
      switch (prop.type) {
        case 'string':
          field = z.string();
          if (prop.description) field = field.describe(prop.description as string);
          break;
        case 'number':
        case 'integer':
          field = z.number();
          if (prop.description) field = field.describe(prop.description as string);
          break;
        case 'boolean':
          field = z.boolean();
          break;
        case 'array':
          field = z.array(z.any());
          break;
        default:
          field = z.any();
      }
      // 非必填字段用 optional
      if (!required?.includes(key)) {
        field = field.optional();
      }
      shape[key] = field;
    }
    return z.object(shape);
  }

  return z.object({});
}

/**
 * 从 MCP Server 动态获取工具，转换为 LangChain DynamicStructuredTool
 * @returns LangChain 工具数组
 */
export async function getMCPTools() {
  if (!mcpClient || !mcpConnected) return [];

  try {
    const { tools: mcpTools } = await mcpClient.listTools();

    return mcpTools.map((mcpTool) => {
      const zodSchema = jsonSchemaToZod(mcpTool.inputSchema as Record<string, unknown>);

      return tool(
        async (args: Record<string, unknown>) => {
          if (!mcpClient) return 'MCP Client 不可用';

          try {
            const result = await mcpClient.callTool({
              name: mcpTool.name,
              arguments: args,
            });

            // MCP 返回 content 数组，提取 text
            if (Array.isArray(result.content)) {
              return result.content
                .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                .map((c) => c.text)
                .join('\n');
            }
            return JSON.stringify(result.content);
          } catch (e) {
            return `工具调用失败：${(e as Error).message}`;
          }
        },
        {
          name: mcpTool.name,
          description: mcpTool.description ?? '',
          schema: zodSchema,
        }
      );
    });
  } catch (e) {
    console.warn('[mcp-client] Failed to list tools:', (e as Error).message);
    return [];
  }
}

/**
 * 获取工具列表：优先 MCP，降级为硬编码
 * 这是对外的主入口，agent.ts 调用此函数获取工具
 */
export async function getTools() {
  const connected = await connectMCP();
  if (connected) {
    const mcpTools = await getMCPTools();
    if (mcpTools.length > 0) {
      console.log(`[mcp-client] Using ${mcpTools.length} MCP tools`);
      return mcpTools;
    }
  }

  // 降级：使用硬编码工具
  console.log('[mcp-client] Using hardcoded tools (fallback)');
  return hardcodedTools;
}

/**
 * 断开 MCP 连接
 */
export async function disconnectMCP(): Promise<void> {
  if (mcpClient && mcpConnected) {
    await mcpClient.close();
    mcpConnected = false;
    mcpClient = null;
  }
}
