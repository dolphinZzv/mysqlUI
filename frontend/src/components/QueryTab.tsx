import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database as DatabaseIcon,
  Eraser,
  History,
  Loader2,
  Play,
  Server,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Connection, DatabaseInfo, QueryResult } from "@/lib/types";
import type { QueryTabDef } from "@/lib/tabs";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResultGrid } from "@/components/ResultGrid";

interface Props {
  tab: QueryTabDef;
  connections: Connection[];
}

const HISTORY_KEY = "mysqlui.queryHistory";

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function QueryTab({ tab, connections }: Props) {
  const [connectionId, setConnectionId] = useState(tab.connectionId);
  const [database, setDatabase] = useState(tab.database || "");
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadHistory());

  const gutterRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const connection = useMemo(
    () => connections.find((c) => c.id === connectionId),
    [connections, connectionId]
  );

  const loadDatabases = useCallback(async (id: string) => {
    try {
      const list = await api.listDatabases(id);
      setDatabases(list.filter((d) => !d.isSystem));
    } catch {
      setDatabases([]);
    }
  }, []);

  useEffect(() => {
    if (connectionId) void loadDatabases(connectionId);
  }, [connectionId, loadDatabases]);

  // If the bound connection was deleted, fall back to the first available one.
  useEffect(() => {
    if (connections.length > 0 && !connections.some((c) => c.id === connectionId)) {
      setConnectionId(connections[0].id);
      setDatabase("");
    }
  }, [connections, connectionId]);

  const lineCount = Math.max(1, sql.split("\n").length);

  const pushHistory = (text: string) => {
    setHistory((prev) => {
      const next = [text, ...prev.filter((h) => h !== text)].slice(0, 30);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  };

  const run = async () => {
    const text = sql.trim();
    if (!text) return;
    if (!connectionId) {
      toast.error("Select a connection first");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await api.runQuery(connectionId, database, text);
      setResult(res);
      pushHistory(text);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const startPos = el.selectionStart;
      const endPos = el.selectionEnd;
      const next = sql.substring(0, startPos) + "  " + sql.substring(endPos);
      setSql(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = startPos + 2;
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Server className="h-4 w-4 text-primary" />
        <Select value={connectionId} onValueChange={(v) => { setConnectionId(v); setDatabase(""); }}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Connection" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={database || "__none__"} onValueChange={(v) => setDatabase(v === "__none__" ? "" : v)}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <DatabaseIcon className="mr-1 h-3.5 w-3.5 text-sky-400" />
            <SelectValue placeholder="Database" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">(no database)</SelectItem>
            {databases.map((d) => (
              <SelectItem key={d.name} value={d.name}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={history.length === 0}>
                <History /> History
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-md">
              <DropdownMenuLabel>Recent queries</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {history.map((h, i) => (
                <DropdownMenuItem key={i} onClick={() => setSql(h)} className="font-mono text-xs">
                  <span className="max-w-[360px] truncate">{h.replace(/\s+/g, " ")}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  setHistory([]);
                  localStorage.removeItem(HISTORY_KEY);
                }}
              >
                <Trash2 /> Clear history
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" variant="outline" onClick={() => { setSql(""); setResult(null); setError(null); }}>
            <Eraser /> Clear
          </Button>
          <Button size="sm" onClick={run} disabled={running || !connectionId}>
            {running ? <Loader2 className="animate-spin" /> : <Play />} Run
            <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">⌘/Ctrl+↵</span>
          </Button>
        </div>
      </div>

      {/* editor */}
      <div className="relative flex h-56 min-h-[140px] shrink-0 border-b bg-card">
        <div
          ref={gutterRef}
          className="scrollbar-thin select-none overflow-hidden border-r bg-muted/30 py-2 text-right font-mono text-[13px] leading-6 text-muted-foreground/60"
          style={{ width: 48 }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="h-6 pr-3">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          spellCheck={false}
          placeholder="SELECT * FROM users LIMIT 100;"
          className="scrollbar-thin h-full w-full resize-none bg-transparent px-3 py-2 font-mono text-[13px] leading-6 outline-none placeholder:text-muted-foreground/40"
        />
      </div>

      {/* result summary */}
      <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-1.5 text-xs">
        {running && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Executing…
          </span>
        )}
        {!running && error && (
          <span className="flex items-center gap-1.5 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> Error
          </span>
        )}
        {!running && !error && result && (
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {result.message}
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" /> {result.durationMs} ms
            </span>
            {result.isQuery && (
              <span className="text-muted-foreground">{formatNumber(result.rowCount)} rows</span>
            )}
            {result.truncated && (
              <Badge variant="warning" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> truncated
              </Badge>
            )}
          </span>
        )}
        {!running && !error && !result && (
          <span className="text-muted-foreground">
            {connection ? `Connected to ${connection.name}` : "No connection"} · press Run to execute
          </span>
        )}
      </div>

      {/* result body */}
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="h-full overflow-auto p-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-[13px] text-destructive">
              {error}
            </div>
          </div>
        ) : result?.isQuery ? (
          <ResultGrid columns={result.columns} rows={result.rows} />
        ) : result ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-lg border bg-card px-6 py-5 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
              <p className="text-sm font-medium">{result.message}</p>
              {result.lastInsertId > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last insert id: <span className="font-mono">{result.lastInsertId}</span>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <Play className="mx-auto mb-2 h-6 w-6 opacity-40" />
              Run a query to see results
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
