/**
 * 环境变量启动校验
 *
 * 应用启动时检查所有必要的 API key / 配置项。
 * 缺少时直接 throw，Vercel 部署日志 / 本地 dev 都能立刻看到。
 */

const REQUIRED_VARS = [
  'DEEPSEEK_API_KEY',
  'ZHIPU_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'TAVILY_API_KEY',
] as const;

const OPTIONAL_VARS = [
  'SILICONFLOW_API_KEY',   // Rerank 精排（无 key 时自动降级为 RRF）
  'ENABLE_MCP',            // MCP 协议（默认 false）
  'ENABLE_PIPELINE',       // 2-Stage Pipeline（默认开启）
  'LANGCHAIN_API_KEY',     // LangSmith 追踪（可选）
  'LANGCHAIN_TRACING',     // LangSmith 开关
  'LANGCHAIN_ENDPOINT',    // LangSmith 端点
  'LANGCHAIN_PROJECT',     // LangSmith 项目名
] as const;

let validated = false;

export function validateEnv() {
  if (validated) return;

  const missing: string[] = [];
  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(
      `[env] 缺少必要环境变量：${missing.join(', ')}\n` +
      '请在 .env.local 中配置，参考 .env.local.example'
    );
  }

  // 可选变量缺失时只 warning
  for (const key of OPTIONAL_VARS) {
    if (!process.env[key]) {
      console.warn(`[env] 可选变量 ${key} 未设置，将使用默认值或降级`);
    }
  }

  validated = true;
  console.log('[env] 环境变量校验通过');
}
