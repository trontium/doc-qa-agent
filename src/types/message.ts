export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'aborted';
export type StageStatus = 'retrieving' | 'generating';

export interface Citation {
  index: number;
  content: string;
  source?: string;
  /** Cross-Encoder rerank 得分（仅启用 rerank 且成功时存在，0~1） */
  rerankScore?: number;
  /** 文档内 chunk 序号，便于用户溯源 */
  chunkIndex?: number;
}

export interface RetrievalMeta {
  /** 用户的原始问题 */
  originalQuery: string;
  /** LLM Query Rewrite 后实际用于检索的 query */
  rewrittenQuery: string;
  /** 是否真的获得 Cross-Encoder 精排分数（无 API key/降级时为 false） */
  rerankApplied: boolean;
}

export interface ToolCall {
  name: string;
  status: 'running' | 'done';
  input?: string;
  output?: string;
  duration?: number; // ms
  startedAt?: number; // timestamp
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  stage?: StageStatus;
  citations?: Citation[];
  /** 2-Stage Retrieval 的可解释性元信息 */
  retrievalMeta?: RetrievalMeta;
  toolCalls?: ToolCall[];
  createdAt: number;
}
