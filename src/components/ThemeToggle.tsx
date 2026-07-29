'use client';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

/**
 * 主题切换按钮 · 右上角
 *
 * - light → 太阳图标
 * - dark → 月亮图标
 * - 挂载后 mount=true 才渲染，避免 SSR/CSR hydration mismatch
 *   (next-themes 官方推荐 pattern，eslint 警告是规则过于严格，这里加 disable 注释)
 */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-9 w-9 shrink-0" aria-hidden />;
  }

  const isDark = (resolvedTheme ?? theme) === 'dark';
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? '切换到浅色' : '切换到深色'}
      title={isDark ? '切换到浅色' : '切换到深色'}
      className="h-9 w-9 shrink-0 rounded-xl border border-border bg-card/80 backdrop-blur hover:bg-muted transition-colors flex items-center justify-center text-foreground/70 hover:text-foreground"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
