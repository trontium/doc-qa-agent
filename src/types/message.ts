export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'aborted';
export type StageStatus = 'retrieving' | 'generating';

export interface Citation {
  index: number;
  content: string;
  source?: string;
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
  toolCalls?: ToolCall[];
  createdAt: number;
}
