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
import { Upload, FileText, Trash2, Loader2, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

interface DocumentItem {
  source: string;
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
  const [password, setPassword] = useState('');   // 删除/上传时输入的密码
  const fileRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => { fetchDocs(); }, []);

  /** 带 Bearer 认证头的 fetch */
  function authFetch(url: string, opts: RequestInit = {}, pwd: string): Promise<Response> {
    return fetch(url, {
      ...opts,
      headers: { ...opts.headers, Authorization: `Bearer ${pwd}` },
    });
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const tid = toast.loading(`上传中：${file.name}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // 上传用 localStorage 缓存的密码
      const savedPwd = localStorage.getItem('admin_pwd') || '';
      const res = savedPwd
        ? await authFetch('/api/upload', { method: 'POST', body: fd }, savedPwd)
        : await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.status === 401) {
        toast.error('密码不正确，无法上传', { id: tid });
        return;
      }
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
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || !password.trim()) return;
    const source = deleteTarget;
    const pwd = password.trim();
    setDeleteTarget(null);
    setPassword('');
    const res = await authFetch(
      `/api/documents?source=${encodeURIComponent(source)}`,
      { method: 'DELETE' },
      pwd,
    );
    const data = await res.json();
    if (res.status === 401) {
      toast.error('密码不正确，无法删除');
      return;
    }
    if (data.ok) {
      toast.success(`已删除 ${data.deleted} 段`);
      // 缓存密码，上传时复用
      localStorage.setItem('admin_pwd', pwd);
      await fetchDocs();
      onAction?.();
    } else {
      toast.error(data.error || '删除失败');
    }
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4 h-full">
      <div className="relative rounded-xl bg-gradient-to-br from-blue-500 via-violet-500 to-purple-600 p-4 text-white shadow-lg shadow-violet-200/50">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📚</span>
          <div>
            <h2 className="font-bold text-lg leading-tight">知识库</h2>
            <p className="text-xs text-white/70">上传文档，Agent 从中检索答案</p>
          </div>
        </div>
      </div>

      <div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".pdf,.docx,.md,.txt"
          onChange={handleUpload}
        />
        <Button
          variant="outline"
          className="w-full rounded-xl border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/50 transition-all"
          onClick={() => fileRef.current?.click()}
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
            <div className="text-center py-8 space-y-2">
              <div className="text-3xl">📄</div>
              <p className="text-xs text-gray-400">还没有上传文档</p>
              <p className="text-[10px] text-gray-300">点击上方按钮添加</p>
            </div>
          )}
          {docs.map((d) => (
            <div
              key={d.source}
              className="text-xs border border-gray-200/80 rounded-xl p-2.5 flex items-start gap-2 hover:bg-blue-50/30 hover:border-blue-200/60 group transition-all duration-150"
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

      {/* 删除确认 + 密码输入 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setPassword(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget === '__null_source__' ? '无 source · 孤儿文档' : deleteTarget}」的所有分段吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 px-1">
            <KeyRound className="w-4 h-4 text-gray-500 shrink-0" />
            <input
              type="password"
              placeholder="输入管理密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmDelete(); }}
              className="flex-1 text-sm border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={!password.trim()}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
