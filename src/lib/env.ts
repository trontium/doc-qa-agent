/**
 * 环境变量惰性校验
 *
 * 不在模块顶层调用（Vercel 构建时没有环境变量），
 * 而是在第一次请求时才检查。
 * 缺少必需变量时直接 throw，请求直接 500。
 */

const REQUIRED_VARS = [
  'DEEPSEEK_API_KEY',
  'ZHIPU_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
] as const;

const OPTIONAL_VARS = [
  'TAVILY_API_KEY',       // web_search 工具（无 key 时 Agent 不调联网搜索）
  'SILICONFLOW_API_KEY',  // Rerank 精排（无 key 时自动降级为 RRF）
  'ENABLE_MCP',           // MCP 协议（默认 false）
  'ENABLE_PIPELINE',      // 2-Stage Pipeline（默认开启）
  'LANGCHAIN_API_KEY',    // LangSmith 追踪（可选）
  'LANGCHAIN_TRACING',    // LangSmith 开关
  'LANGCHAIN_ENDPOINT',   // LangSmith 端点
  'LANGCHAIN_PROJECT',    // LangSmith 项目名
] as const;

let validated = false;

/**
 * 惰性校验：第一次调用时检查，后续跳过。
 * 在 POST handler 内调用，不在模块顶层调用。
 */
export function ensureEnv() {
  if (validated) return;

  const missing: string[] = [];
  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(
      `[env] 缺少必要环境变量：${missing.join(', ')}\n` +
      '请在 .env.local 或 Vercel 环境变量中配置，参考 .env.local.example'
    );
  }

  // 可选变量缺失时只 warning
  for (const key of OPTIONAL_VARS) {
    if (!process.env[key]) {
      console.warn(`[env] 可选变量 ${key} 未设置，将使用默认值或降级`);
    }
  }

  validated = true;
}
