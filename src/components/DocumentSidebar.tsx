'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Trash2, Loader2 } from 'lucide-react';

interface DocumentItem {
  source: string;
  chunks: number;
  uploadedAt: string;
}

export function DocumentSidebar() {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function fetchDocs() {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (data.documents) setDocs(data.documents);
    } catch {}
  }

  useEffect(() => {
    fetchDocs();
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatus(`上传中：${file.name}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok) {
        setStatus(`✅ ${file.name} 已入库 ${data.chunks} 段`);
        await fetchDocs();
      } else {
        setStatus(`❌ ${data.error || '上传失败'}`);
      }
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '网络错误'}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(source: string) {
    if (!confirm(`确认删除 ${source} 的所有分段？`)) return;
    const res = await fetch(`/api/documents?source=${encodeURIComponent(source)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.ok) {
      setStatus(`🗑 已删除 ${data.deleted} 段`);
      await fetchDocs();
    } else {
      setStatus(`❌ ${data.error}`);
    }
  }

  return (
    <aside className="w-72 border-r bg-white p-4 flex flex-col gap-4 overflow-y-auto">
      <div>
        <h2 className="font-bold text-lg mb-1">📚 知识库</h2>
        <p className="text-xs text-gray-500">上传文档后，Agent 可从中检索答案</p>
      </div>

      <div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".pdf,.docx,.md,.txt"
          onChange={handleUpload}
        />
        <Button
          variant="outline"
          className="w-full"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              处理中...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              上传文档
            </>
          )}
        </Button>
        <p className="text-xs text-gray-500 mt-2">支持 PDF / Word / Markdown / TXT</p>
      </div>

      {status && (
        <div className="text-xs bg-gray-100 rounded p-2 break-all">{status}</div>
      )}

      <div className="flex-1 min-h-0">
        <div className="text-xs font-semibold text-gray-500 mb-2">
          已入库 {docs.length} 个文档
        </div>
        <div className="space-y-2">
          {docs.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">还没有上传文档</p>
          )}
          {docs.map((d) => (
            <div
              key={d.source}
              className="text-xs border rounded p-2 flex items-start gap-2 hover:bg-gray-50 group"
            >
              <FileText className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium" title={d.source}>
                  {d.source}
                </div>
                <div className="text-gray-500 mt-0.5">{d.chunks} 段</div>
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 transition text-red-500 hover:text-red-700"
                onClick={() => handleDelete(d.source)}
                title="删除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
