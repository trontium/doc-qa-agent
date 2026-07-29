export default function Loading() {
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar skeleton */}
      <aside className="w-72 border-r border-border bg-card p-4 flex flex-col gap-4">
        <div className="space-y-2">
          <div className="h-6 w-24 bg-muted rounded animate-pulse" />
          <div className="h-4 w-40 bg-muted/60 rounded animate-pulse" />
        </div>
        <div className="h-9 w-full bg-muted rounded animate-pulse" />
        <div className="space-y-2 flex-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 w-full bg-muted/60 rounded animate-pulse" />
          ))}
        </div>
      </aside>

      {/* Main skeleton */}
      <main className="flex-1 flex flex-col max-w-4xl mx-auto p-6">
        <header className="mb-4 space-y-2">
          <div className="h-8 w-56 bg-muted rounded animate-pulse" />
          <div className="h-4 w-40 bg-muted/60 rounded animate-pulse" />
        </header>
        <div className="flex-1 border border-border rounded-lg p-4 bg-card space-y-4">
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-muted/60 rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-muted/60 rounded animate-pulse" />
            </div>
          </div>
        </div>
        <div className="mt-4 h-16 w-full bg-muted/60 rounded animate-pulse" />
      </main>
    </div>
  );
}
