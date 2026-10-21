import { useMemo, useState } from "react";
import { Clock, Copy, History, Pin, Play, Search, Star, Trash2 } from "lucide-react";
import type { QueryHistoryItem } from "@/lib/queryHistory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: QueryHistoryItem[];
  favorites: string[];
  onRun: (sql: string) => void;
  onCopy: (sql: string) => void;
  onPin: (item: QueryHistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function QueryHistoryDialog({
  open,
  onOpenChange,
  items,
  favorites,
  onRun,
  onCopy,
  onPin,
  onDelete,
  onClear,
}: Props) {
  const [search, setSearch] = useState("");
  const [connection, setConnection] = useState("__all__");
  const [database, setDatabase] = useState("__all__");

  const connections = useMemo(
    () => Array.from(new Set(items.map((h) => h.connectionName).filter(Boolean))) as string[],
    [items]
  );
  const databases = useMemo(
    () => Array.from(new Set(items.map((h) => h.database).filter(Boolean))) as string[],
    [items]
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((h) => {
      if (connection !== "__all__" && h.connectionName !== connection) return false;
      if (database !== "__all__" && (h.database || "") !== database) return false;
      if (q && !h.sql.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, connection, database]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" /> Query history
          </DialogTitle>
          <DialogDescription>
            Search, filter by connection/database, copy, pin or rerun previous queries.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 w-[260px] pl-7 text-xs"
              placeholder="Search SQL"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={connection} onValueChange={setConnection}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All connections</SelectItem>
              {connections.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={database} onValueChange={setDatabase}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All databases</SelectItem>
              {databases.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary">{filtered.length}</Badge>
          <Button size="sm" variant="outline" className="ml-auto text-destructive" onClick={onClear} disabled={items.length === 0}>
            <Trash2 /> Clear history
          </Button>
        </div>
        <div className="scrollbar-thin max-h-[58vh] overflow-auto rounded-md border">
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No matching history.</p>
          ) : (
            <div className="divide-y">
              {filtered.map((item) => (
                <div key={item.id} className="group flex items-start gap-3 px-3 py-2 hover:bg-muted/30">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <pre className="max-h-16 overflow-hidden whitespace-pre-wrap break-all font-mono text-[12px] leading-snug">
                      {item.sql}
                    </pre>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      {item.connectionName && <span>{item.connectionName}</span>}
                      {item.database && <span>/ {item.database}</span>}
                      <span>{new Date(item.at).toLocaleString()}</span>
                      {favorites.includes(item.sql) && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                    <Button size="icon-sm" variant="ghost" title="Run" onClick={() => onRun(item.sql)}>
                      <Play />
                    </Button>
                    <Button size="icon-sm" variant="ghost" title="Copy" onClick={() => onCopy(item.sql)}>
                      <Copy />
                    </Button>
                    <Button size="icon-sm" variant="ghost" title="Pin to sidebar" onClick={() => onPin(item)}>
                      <Pin />
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="hover:text-destructive" title="Delete" onClick={() => onDelete(item.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
