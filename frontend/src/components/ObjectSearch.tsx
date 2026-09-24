import { useEffect, useMemo, useState } from "react";
import { Columns3, Loader2, Search, Table2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Connection, SearchResult } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: Connection[];
  activeConnectionId?: string;
  onOpenTable: (connection: Connection, database: string, table: string) => void;
}

export function ObjectSearch({ open, onOpenChange, connections, activeConnectionId, onOpenTable }: Props) {
  const { t } = useI18n();
  const [connectionId, setConnectionId] = useState(activeConnectionId ?? connections[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setConnectionId(activeConnectionId ?? connections[0]?.id ?? "");
      setQuery("");
      setResult(null);
    }
  }, [open, activeConnectionId, connections]);

  useEffect(() => {
    if (!open || !connectionId || query.trim().length < 2) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(() => {
      api
        .globalSearch(connectionId, query.trim())
        .then((r) => {
          if (!cancelled) setResult(r);
        })
        .catch(() => {
          if (!cancelled) setResult(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, connectionId, query]);

  const connection = useMemo(() => connections.find((c) => c.id === connectionId), [connections, connectionId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" /> {t("app.search", "Global search")}
          </DialogTitle>
          <DialogDescription>{t("search.hint", "Search tables and columns across all databases")}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Select value={connectionId} onValueChange={setConnectionId}>
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue placeholder="connection" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="h-9 pl-9"
              placeholder={t("search.placeholder", "Search table or column name…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
        </div>

        <div className="scrollbar-thin max-h-[55vh] min-h-[160px] overflow-auto rounded-lg border">
          {!result ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {query.trim().length < 2 ? t("search.hint", "Type at least 2 characters") : t("search.noResults", "No results")}
            </p>
          ) : (
            <>
              {result.tables.length > 0 && (
                <div>
                  <div className="sticky top-0 border-b bg-muted/70 px-3 py-1.5 text-[11px] font-medium uppercase text-muted-foreground">
                    {t("search.tables", "Tables")} ({result.tables.length})
                  </div>
                  {result.tables.map((tb) => (
                    <button
                      key={`${tb.database}.${tb.table}`}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        if (connection) onOpenTable(connection, tb.database, tb.table);
                        onOpenChange(false);
                      }}
                    >
                      <Table2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="font-mono">{tb.table}</span>
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {tb.database}
                      </Badge>
                      {tb.tableType === "VIEW" && <Badge variant="warning" className="text-[10px]">view</Badge>}
                    </button>
                  ))}
                </div>
              )}

              {result.columns.length > 0 && (
                <div>
                  <div className="sticky top-0 border-y bg-muted/70 px-3 py-1.5 text-[11px] font-medium uppercase text-muted-foreground">
                    {t("search.columns", "Columns")} ({result.columns.length})
                  </div>
                  {result.columns.map((c) => (
                    <button
                      key={`${c.database}.${c.table}.${c.column}`}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        if (connection) onOpenTable(connection, c.database, c.table);
                        onOpenChange(false);
                      }}
                    >
                      <Columns3 className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span className="font-mono">{c.column}</span>
                      <span className="text-xs text-muted-foreground">{c.columnType}</span>
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {c.database}.{c.table}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
