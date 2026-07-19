'use client';
import { useState, type ReactNode } from 'react';
import type { ToolCall } from '@/types/message';

function toolLabel(name: string): string {
  switch (name) {
    case 'retrieve_docs':
      return '📚 检索知识库';
    case 'web_search':
      return '🌐 搜索互联网';
    case 'calculator':
      return '🧮 计算器';
    default:
      return `🔧 ${name}`;
  }
}

function JsonBlock({ data, label }: { data: string; label: string }) {
  // 尝试美化 JSON
  let display: string;
  try {
    const parsed = JSON.parse(data);
    display = JSON.stringify(parsed, null, 2);
  } catch {
    display = data;
  }
  return (
    <div className="mt-1">
      <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{label}</div>
      <pre className="text-[11px] text-gray-600 bg-gray-50 rounded p-1.5 mt-0.5 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
        {display}
      </pre>
    </div>
  );
}

function ToolCallDetailComp({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = toolCall.status === 'running';
  const isDone = toolCall.status === 'done';
  const hasDetails = toolCall.input || toolCall.output;

  return (
    <div className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => hasDetails ? setExpanded(!expanded) : undefined}
        className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
          isRunning
            ? 'bg-yellow-50 border-yellow-300 text-yellow-800'
            : 'bg-green-50 border-green-300 text-green-800'
        } ${hasDetails ? 'cursor-pointer hover:bg-opacity-80' : 'cursor-default'}`}
      >
        {isRunning ? (
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
        ) : (
          <span className="text-green-600">✓</span>
        )}
        {toolLabel(toolCall.name)}
        {toolCall.duration != null && (
          <span className="text-[10px] opacity-70">{toolCall.duration}ms</span>
        )}
        {hasDetails && (
          <span className="text-[10px] opacity-50">{expanded ? '▲' : '▼'}</span>
        )}
      </button>
      {expanded && hasDetails && (
        <div className="mt-1 ml-2 border-l-2 border-gray-200 pl-2 max-w-xs">
          {toolCall.input && (
            <JsonBlock data={toolCall.input} label="输入" />
          )}
          {toolCall.output && (
            <JsonBlock data={toolCall.output} label="输出" />
          )}
        </div>
      )}
    </div>
  );
}

export const ToolCallDetail = ToolCallDetailComp;
