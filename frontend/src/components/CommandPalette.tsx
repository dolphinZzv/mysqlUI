import { useEffect, useMemo, useRef, useState } from "react";
import { Command, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface PaletteAction {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteAction[];
}

export function CommandPalette({ open, onOpenChange, actions }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((action) =>
      `${action.label} ${action.group} ${action.keywords ?? ""}`.toLowerCase().includes(q)
    );
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (action: PaletteAction | undefined) => {
    if (!action) return;
    onOpenChange(false);
    window.setTimeout(action.run, 0);
  };

  let lastGroup = "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Command className="h-4 w-4 text-primary" /> Command palette
          </DialogTitle>
          <DialogDescription className="sr-only">Search and run application commands.</DialogDescription>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm outline-none focus:border-primary"
              placeholder="Type a command or tab name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(filtered.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  run(filtered[active]);
                }
              }}
            />
          </div>
        </DialogHeader>
        <div ref={listRef} className="scrollbar-thin max-h-[55vh] min-h-[180px] overflow-auto p-2">
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">No matching commands.</p>
          )}
          {filtered.map((action, index) => {
            const showGroup = action.group !== lastGroup;
            lastGroup = action.group;
            return (
              <div key={action.id}>
                {showGroup && (
                  <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {action.group}
                  </div>
                )}
                <button
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    index === active ? "bg-primary/15 text-foreground" : "hover:bg-muted/60"
                  )}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(action)}
                >
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  {action.shortcut && (
                    <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {action.shortcut}
                    </kbd>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>Esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
