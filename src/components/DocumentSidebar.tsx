'use client';
import { SidebarContent } from '@/components/SidebarContent';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 桌面端：固定 aside 侧边栏 */
export function DocumentSidebar() {
  return (
    <aside className="hidden md:flex w-72 border-r border-border bg-gradient-to-b from-card to-muted/30 flex-col">
      <SidebarContent />
    </aside>
  );
}

/** 移动端：Sheet 滑出 + 汉堡按钮 */
export function MobileSidebarButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} className="md:hidden">
      <Menu className="w-5 h-5" />
    </Button>
  );
}

export function MobileSidebar({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>知识库</SheetTitle>
          <SheetDescription>上传和管理文档</SheetDescription>
        </SheetHeader>
        <SidebarContent onAction={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
