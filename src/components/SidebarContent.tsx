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
import { Upload, FileText, Trash2, Loader2, Key, CheckCircle2 } from 'lucide-react';
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
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [tokenValue, setTokenValue] = useState('');
  const [adminSet, setAdminSet] = useState(false); // 跟踪 token 是否已设置
  const inputRef = useRef<HTMLInputElement>(null);

  /** 获取管理认证头（优先 localStorage，回退 NEXT_PUBLIC 环境变量） */
  function authHeaders(): HeadersInit {
    const token = localStorage.getItem('admin_token') || process.env.NEXT_PUBLIC_ADMIN_TOKEN;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** 当前是否有 admin token（用于 UI 提示） */
  function hasAdminToken(): boolean {
    return !!(localStorage.getItem('admin_token') || process.env.NEXT_PUBLIC_ADMIN_TOKEN);
  }

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
    setAdminSet(hasAdminToken());
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const tid = toast.loading(`上传中：${file.name}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd, headers: authHeaders() });
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
      headers: authHeaders(),
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
          onClick={() => {
            if (!adminSet) {
              toast.error('请先设置管理员 Token');
              setShowTokenInput(true);
              return;
            }
            inputRef.current?.click();
          }}
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
                onClick={() => {
                  if (!adminSet) {
                    toast.error('请先设置管理员 Token');
                    setShowTokenInput(true);
                    return;
                  }
                  setDeleteTarget(d.source);
                }}
                title="删除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Admin Token 设置 */}
      <div className="border-t pt-3 mt-auto">
        {adminSet ? (
          <button
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            onClick={() => {
              localStorage.removeItem('admin_token');
              setAdminSet(false);
              toast.success('已清除管理员 Token');
            }}
          >
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            管理员已授权 · 点击清除
          </button>
        ) : (
          <div>
            <button
              className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 mb-2"
              onClick={() => setShowTokenInput(!showTokenInput)}
            >
              <Key className="w-3 h-3" />
              设置管理员 Token
            </button>
            {showTokenInput && (
              <div className="flex gap-1">
                <input
                  type="password"
                  placeholder="输入 Admin Token"
                  value={tokenValue}
                  onChange={(e) => setTokenValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tokenValue.trim()) {
                      localStorage.setItem('admin_token', tokenValue.trim());
                      setAdminSet(true);
                      setTokenValue('');
                      setShowTokenInput(false);
                      toast.success('管理员 Token 已设置');
                    }
                  }}
                  className="flex-1 text-xs border rounded px-2 py-1 bg-white"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs px-2"
                  onClick={() => {
                    if (!tokenValue.trim()) return;
                    localStorage.setItem('admin_token', tokenValue.trim());
                    setAdminSet(true);
                    setTokenValue('');
                    setShowTokenInput(false);
                    toast.success('管理员 Token 已设置');
                  }}
                >
                  确定
                </Button>
              </div>
            )}
          </div>
        )}
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
