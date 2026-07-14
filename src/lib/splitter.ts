/**
 * 递归字符切分器 —— 中文友好版。
 *
 * 参考 LangChain RecursiveCharacterTextSplitter 的思想，但我们自实现避免多装一个大包。
 * 核心策略：按分隔符层级递归切分，尽量在语义边界（段落 → 句号 → 逗号 → 空格）断开。
 *
 * 参数：
 *   chunkSize    每段目标长度（字符数，含中文按 1 计）
 *   chunkOverlap 相邻段重叠字符数（保留边界上下文）
 *   separators   分隔符优先级列表（从粗到细）
 */

const DEFAULT_SEPARATORS = ['\n\n', '\n', '。', '！', '？', '，', ' ', ''];

export interface SplitOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export function splitText(
  text: string,
  { chunkSize = 800, chunkOverlap = 100, separators = DEFAULT_SEPARATORS }: SplitOptions = {}
): string[] {
  if (text.length <= chunkSize) return [text.trim()].filter(Boolean);

  // 找到第一个能命中的分隔符
  const sep = separators.find((s) => s === '' || text.includes(s)) ?? '';
  const parts = sep === '' ? Array.from(text) : text.split(sep);

  // 用滑动窗口把 parts 合成 chunkSize 长度的段
  const chunks: string[] = [];
  let buf = '';

  for (const part of parts) {
    const piece = sep === '' ? part : part + sep;
    if ((buf + piece).length <= chunkSize) {
      buf += piece;
      continue;
    }

    if (buf) chunks.push(buf.trim());

    // 单个 part 超过 chunkSize：用下一级 separator 递归切
    if (piece.length > chunkSize) {
      const restSeparators = separators.slice(separators.indexOf(sep) + 1);
      const subChunks = splitText(piece, { chunkSize, chunkOverlap, separators: restSeparators.length ? restSeparators : [''] });
      chunks.push(...subChunks);
      buf = '';
    } else {
      // overlap：保留 buf 尾部的一小段拼到下一个 chunk 头
      buf = chunkOverlap > 0 ? buf.slice(-chunkOverlap) + piece : piece;
    }
  }

  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter((c) => c.length > 0);
}
