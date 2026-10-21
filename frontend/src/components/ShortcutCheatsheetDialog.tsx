import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUPS: { title: string; items: { keys: string; action: string }[] }[] = [
  {
    title: "Global",
    items: [
      { keys: "Ctrl/⌘+K", action: "Search tables and columns" },
      { keys: "Ctrl/⌘+Shift+P", action: "Command palette" },
      { keys: "Ctrl/⌘+Alt+N", action: "New query" },
      { keys: "Ctrl/⌘+Alt+← / →", action: "Previous / next tab" },
      { keys: "Ctrl/⌘+Alt+W", action: "Close active tab" },
      { keys: "Ctrl/⌘+Alt+B", action: "Toggle sidebar" },
      { keys: "Ctrl/⌘+Alt+E", action: "Focus SQL editor" },
      { keys: "?", action: "Open this shortcut sheet" },
    ],
  },
  {
    title: "SQL editor",
    items: [
      { keys: "Ctrl/⌘+Enter", action: "Run statement under cursor or selection" },
      { keys: "Ctrl/⌘+Shift+Enter", action: "Run all statements" },
      { keys: "Ctrl/⌘+Space", action: "Open autocomplete" },
      { keys: "Tab", action: "Insert two spaces" },
    ],
  },
  {
    title: "Data grid",
    items: [
      { keys: "Ctrl/⌘+A", action: "Select all rows on the page" },
      { keys: "Delete / Backspace", action: "Delete selected rows" },
      { keys: "Enter", action: "Open focused row details" },
      { keys: "Esc", action: "Clear cell selection / close details" },
      { keys: "Ctrl/⌘+C", action: "Copy selected cell range as TSV" },
      { keys: "Ctrl/⌘+V", action: "Paste TSV/CSV at the focused cell" },
      { keys: "Arrow keys / Tab", action: "Move the focused cell" },
    ],
  },
];

export function ShortcutCheatsheetDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-primary" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>Work without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} className={group.title === "Data grid" ? "sm:col-span-2" : ""}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h3>
              <div className="rounded-md border">
                {group.items.map((item, index) => (
                  <div key={item.keys} className={index ? "flex items-center gap-3 border-t px-3 py-1.5" : "flex items-center gap-3 px-3 py-1.5"}>
                    <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{item.keys}</kbd>
                    <span className="text-xs">{item.action}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
