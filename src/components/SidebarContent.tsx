'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Upload, FileText, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface DocumentItem {
  source: string;
  /** 前端展示名（孤儿文档会显示 "(无 source · 孤儿文档)"）*/
  displaySource?: string;
  chunks: number;
  uploadedAt: string;
}

/** 侧边栏核心内容（桌面 aside / 移动端 Sheet 共用） */
export function SidebarContent({ onAction }: { onAction?: () => void }) {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function fetchDocs() {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (data.documents) setDocs(data.documents);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDocs();
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const tid = toast.loading(`上传中：${file.name}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok) {
        toast.success(`${file.name} 已入库 ${data.chunks} 段`, { id: tid });
        await fetchDocs();
        onAction?.();
      } else {
        toast.error(data.error || '上传失败', { id: tid });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '网络错误', { id: tid });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const source = deleteTarget;
    setDeleteTarget(null);
    const res = await fetch(`/api/documents?source=${encodeURIComponent(source)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.ok) {
      toast.success(`已删除 ${data.deleted} 段`);
      await fetchDocs();
      onAction?.();
    } else {
      toast.error(data.error || '删除失败');
    }
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
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
        <p className="text-xs text-gray-500 mt-2">支持 PDF / Word / Markdown / TXT · 单文件 ≤ 5MB</p>
      </div>

      <div className="flex-1 min-h-0">
        <div className="text-xs font-semibold text-gray-500 mb-2">
          已入库 {docs.length} 个文档
        </div>
        <div className="space-y-2">
          {loading && Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 w-full bg-gray-100 rounded animate-pulse" />
          ))}
          {!loading && docs.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">还没有上传文档</p>
          )}
          {docs.map((d) => (
            <div
              key={d.source}
              className="text-xs border rounded p-2 flex items-start gap-2 hover:bg-gray-50 group"
            >
              <FileText className={`w-4 h-4 shrink-0 mt-0.5 ${d.source === '__null_source__' ? 'text-red-400' : 'text-blue-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium" title={d.source}>
                  {d.displaySource ?? d.source}
                </div>
                <div className="text-gray-500 mt-0.5">
                  {d.chunks} 段
                  {d.source === '__null_source__' && (
                    <span className="ml-1 text-red-500">· 建议删除</span>
                  )}
                </div>
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 transition text-red-500 hover:text-red-700"
                onClick={() => setDeleteTarget(d.source)}
                title="删除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* AlertDialog 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget === '__null_source__' ? '无 source · 孤儿文档' : deleteTarget}」的所有分段吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
