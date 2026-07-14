export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'aborted';

export interface Citation {
  index: number;
  content: string;
  source?: string;
}

export interface ToolCall {
  name: string;
  status: 'running' | 'done';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  citations?: Citation[];
  toolCalls?: ToolCall[];
  createdAt: number;
}
