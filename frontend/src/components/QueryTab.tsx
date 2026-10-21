import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Copy,
  Database as DatabaseIcon,
  Download,
  Eraser,
  FileJson,
  FileSpreadsheet,
  FileText,
  Hammer,
  History,
  Loader2,
  PanelRight,
  Pin,
  PinOff,
  Play,
  Server,
  Square,
  Star,
  Table2,
  Timer,
  Trash2,
  TrendingUp,
  Upload,
  Wand2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Connection, DatabaseInfo, QueryResult } from "@/lib/types";
import type { QueryTabDef } from "@/lib/tabs";
import { useI18n } from "@/lib/i18n";
import { findPinnedQuery, pinQuery, unpinQuery, usePinnedQueries } from "@/lib/pinnedQueries";
import { readQueryDraft, writeQueryDraft } from "@/lib/queryDrafts";
import {
  clearQueryHistory,
  loadQueryHistory,
  pushQueryHistory,
  removeQueryHistory,
  type QueryHistoryItem,
} from "@/lib/queryHistory";
import { QueryHistoryDialog } from "@/components/QueryHistoryDialog";
import { formatSQL } from "@/lib/sqlFormat";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResultGrid } from "@/components/ResultGrid";
import { ChartView } from "@/components/ChartView";
import { ExplainDialog } from "@/components/ExplainDialog";
import { SqlEditor, type SqlSchema } from "@/components/SqlEditor";
import { QueryBuilder } from "@/components/QueryBuilder";
import { SnippetPanel } from "@/components/SnippetPanel";
import { ParameterDialog } from "@/components/ParameterDialog";
import { extractParams } from "@/lib/sqlParams";
import { assessSQLRisk, type SqlRisk } from "@/lib/sqlRisk";
import { lineAt, statementAt } from "@/lib/sqlStatement";
import { RiskDialog } from "@/components/RiskDialog";

interface Props {
  tab: QueryTabDef;
  connections: Connection[];
}

const FAVORITES_KEY = "mysqlui.favorites";
const TIMEOUT_KEY = "mysqlui.queryTimeout";
const QUERY_PAGE_SIZE = 1000;

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(columns: string[], rows: unknown[][]): string {
  const head = columns.map(csvEscape).join(",");
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return head + "\n" + body;
}

function toINSERT(table: string, columns: string[], rows: unknown[][]): string {
  const cols = columns.map((c) => `\`${c}\``).join(", ");
  const literal = (v: unknown) => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  };
  return rows
    .map((r) => `INSERT INTO \`${table || "table"}\` (${cols}) VALUES (${r.map(literal).join(", ")});`)
    .join("\n");
}

function toXLS(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${columns
    .map((c) => `<th>${esc(c)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></body></html>`;
}

function sqlLiteralValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function toMarkdown(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${columns.map(esc).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(esc).join(" | ")} |`),
  ].join("\n");
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function QueryTab({ tab, connections }: Props) {
  const { t } = useI18n();
  const [connectionId, setConnectionId] = useState(tab.connectionId);
  const [database, setDatabase] = useState(tab.database || "");
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [schema, setSchema] = useState<SqlSchema>({ tables: [] });
  const [sql, setSql] = useState(() => tab.initialSql ?? readQueryDraft(tab.id)?.sql ?? "");
  const selectionRef = useRef<{ start: number; end: number } | undefined>(
    tab.initialSelection ?? readQueryDraft(tab.id)?.selection
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [activeResult, setActiveResult] = useState(0);
  const [resultSelected, setResultSelected] = useState<Set<number>>(new Set());
  const [resultHidden, setResultHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<QueryHistoryItem[]>(loadQueryHistory);
  const [favorites, setFavorites] = useState<string[]>(() => loadJSON<string[]>(FAVORITES_KEY, []));
  const [historyFilter, setHistoryFilter] = useState("");
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const pinnedQueries = usePinnedQueries();
  const pinnedQuery = findPinnedQuery(pinnedQueries, connectionId, database, sql.trim());
  const [builderOpen, setBuilderOpen] = useState(false);
  const [view, setView] = useState<"table" | "chart">("table");
  const [explainOpen, setExplainOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef("");
  if (!sessionIdRef.current) {
    sessionIdRef.current = `qs:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  }
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const canceledRef = useRef(false);
  const [timeoutSec, setTimeoutSec] = useState(() => {
    const stored = Number(localStorage.getItem(TIMEOUT_KEY));
    return [0, 30, 60, 300].includes(stored) ? stored : 60;
  });
  const [inTransaction, setInTransaction] = useState(false);
  const [txBusy, setTxBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastRunSql, setLastRunSql] = useState("");
  const [snippetsOpen, setSnippetsOpen] = useState(() => localStorage.getItem("mysqlui.snippetsOpen") === "1");
  const [paramRequest, setParamRequest] = useState<{ sql: string; names: string[]; startLine: number } | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [riskRequest, setRiskRequest] = useState<{
    text: string;
    startLine: number;
    risks: SqlRisk[];
    estimatedRows: number | null;
    estimating: boolean;
  } | null>(null);
  const riskThreshold = 1000;

  const connection = useMemo(() => connections.find((c) => c.id === connectionId), [connections, connectionId]);

  useEffect(() => {
    if (!connectionId) return;
    api
      .listDatabases(connectionId)
      .then((list) => setDatabases(list.filter((d) => !d.isSystem)))
      .catch(() => setDatabases([]));
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !database) {
      setSchema({ tables: [] });
      return;
    }
    api
      .databaseSchema(connectionId, database)
      .then(setSchema)
      .catch(() => setSchema({ tables: [] }));
  }, [connectionId, database]);

  useEffect(() => {
    if (connections.length > 0 && !connections.some((c) => c.id === connectionId)) {
      setConnectionId(connections[0].id);
      setDatabase("");
    }
  }, [connections, connectionId]);

  useEffect(() => {
    setInTransaction(false);
  }, [connectionId, database]);

  useEffect(() => {
    writeQueryDraft(tab.id, { sql, selection: selectionRef.current });
  }, [sql, tab.id]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; sql: string };
      if (detail?.id === tab.id) setSql(detail.sql);
    };
    window.addEventListener("mysqlui:setSql", handler);
    return () => window.removeEventListener("mysqlui:setSql", handler);
  }, [tab.id]);

  const pushHistory = (text: string) => {
    setHistory((prev) =>
      pushQueryHistory(prev, {
        sql: text,
        connectionId,
        connectionName: connection?.name ?? tab.connectionName,
        database,
      })
    );
  };

  const runRaw = useCallback(
    async (text: string, startLine = 1) => {
      if (!text) return;
      if (!connectionId) {
        toast.error(t("query.connection", "Connection") + " ?");
        return;
      }
      const runId = `run:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
      canceledRef.current = false;
      setActiveRunId(runId);
      setRunning(true);
      setError(null);
      setErrorLine(null);
      try {
        const res = await api.runQuery(connectionId, database, text, {
          runId,
          sessionId: sessionIdRef.current,
          timeoutSec,
          pageSize: QUERY_PAGE_SIZE,
          pageOffset: 0,
        });
        setResult(res);
        setLastRunSql(text);
        const count = (res.results?.length ?? 0) + (res.isQuery ? 1 : 0);
        setActiveResult(Math.max(0, count - 1));
        if (/^\s*(BEGIN|START\s+TRANSACTION)\b/i.test(text)) setInTransaction(true);
        else if (/^\s*(COMMIT|ROLLBACK)\b/i.test(text)) setInTransaction(false);
        pushHistory(text);
      } catch (err) {
        setResult(null);
        setActiveResult(0);
        if (canceledRef.current) setInTransaction(false);
        const message = canceledRef.current
          ? t("query.canceled", "Query canceled")
          : err instanceof Error
            ? err.message
            : String(err);
        setError(message);
        const match = message.match(/at line (\d+)/i);
        if (match && !canceledRef.current) setErrorLine(startLine + Number(match[1]) - 1);
      } finally {
        setActiveRunId(null);
        setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectionId, database, timeoutSec, t]
  );

  const assessAndRun = useCallback(
    (text: string, startLine: number) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const names = extractParams(trimmed);
      if (names.length > 0) {
        setParamRequest({ sql: trimmed, names, startLine });
        return;
      }
      const risks = assessSQLRisk(trimmed);
      if (risks.length === 0) {
        if (/^\s*(UPDATE|DELETE)\b/i.test(trimmed) && connectionId) {
          api
            .estimateQuery(connectionId, database, trimmed)
            .then((estimate) => {
              if (estimate.estimatedRows >= riskThreshold) {
                setRiskRequest({
                  text: trimmed,
                  startLine,
                  risks: [
                    {
                      level: "warning",
                      message: `EXPLAIN estimates ${estimate.estimatedRows.toLocaleString()} affected row(s), above the ${riskThreshold.toLocaleString()} row threshold.`,
                    },
                  ],
                  estimatedRows: estimate.estimatedRows,
                  estimating: false,
                });
              } else {
                void runRaw(trimmed, startLine);
              }
            })
            .catch(() => void runRaw(trimmed, startLine));
          return;
        }
        void runRaw(trimmed, startLine);
        return;
      }
      setRiskRequest({ text: trimmed, startLine, risks, estimatedRows: null, estimating: false });
      if (/^\s*(UPDATE|DELETE)\b/i.test(trimmed) && connectionId) {
        setRiskRequest((prev) => (prev ? { ...prev, estimating: true } : prev));
        api
          .estimateQuery(connectionId, database, trimmed)
          .then((estimate) =>
            setRiskRequest((prev) =>
              prev ? { ...prev, estimating: false, estimatedRows: estimate.estimatedRows } : prev
            )
          )
          .catch(() =>
            setRiskRequest((prev) => (prev ? { ...prev, estimating: false, estimatedRows: -1 } : prev))
          );
      }
    },
    [connectionId, database, runRaw]
  );

  const run = useCallback(
    (override?: string, options?: { cursor: number; all: boolean; selectionStart?: number }) => {
      let text = sql;
      let startLine = 1;
      if (override) {
        text = override;
        startLine = lineAt(sql, options?.selectionStart ?? 0);
      } else if (!options?.all) {
        const range = statementAt(sql, options?.cursor ?? selectionRef.current?.start ?? 0);
        text = range.text;
        startLine = range.startLine;
      }
      assessAndRun(text, startLine);
    },
    [sql, assessAndRun]
  );

  const cancel = useCallback(async () => {
    if (!activeRunId || !connectionId) return;
    canceledRef.current = true;
    try {
      await api.cancelQuery(connectionId, activeRunId);
      toast.info(t("query.canceled", "Query canceled"));
    } catch (err) {
      toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
    }
  }, [activeRunId, connectionId, t]);

  const transaction = useCallback(
    async (command: "START TRANSACTION" | "COMMIT" | "ROLLBACK") => {
      if (!connectionId) return;
      setTxBusy(true);
      try {
        await api.runQuery(connectionId, database, command, { sessionId: sessionIdRef.current, timeoutSec: 30 });
        setInTransaction(command === "START TRANSACTION");
        toast.success(t("query.txDone", "Transaction command executed"));
      } catch (err) {
        toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
      } finally {
        setTxBusy(false);
      }
    },
    [connectionId, database, timeoutSec, t],
  );

  const loadMore = useCallback(async () => {
    if (!connectionId || !result?.isQuery || !result.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.runQuery(connectionId, database, lastRunSql, {
        sessionId: sessionIdRef.current,
        timeoutSec,
        pageSize: QUERY_PAGE_SIZE,
        pageOffset: result.rows.length,
      });
      setResult((prev) => {
        if (!prev) return res;
        const rows = [...prev.rows, ...res.rows];
        return {
          ...prev,
          rows,
          rowCount: rows.length,
          hasMore: res.hasMore,
          message: `${rows.length} row(s) loaded`,
          truncated: prev.truncated || res.truncated,
        };
      });
    } catch (err) {
      toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoadingMore(false);
    }
  }, [connectionId, database, result, lastRunSql, timeoutSec, loadingMore, t]);

  const runFile = useCallback(
    async (file: File) => {
      if (!connectionId) {
        toast.error(t("query.connection", "Connection") + " ?");
        return;
      }
      setRunning(true);
      setError(null);
      try {
        const res = await api.runSQLFile(connectionId, database, file);
        setResult(res);
        const count = (res.results?.length ?? 0) + (res.isQuery ? 1 : 0);
        setActiveResult(Math.max(0, count - 1));
        toast.success(t("query.importSqlDone", "Executed {n} statement(s)", { n: res.statements ?? 0 }));
      } catch (err) {
        setResult(null);
        setActiveResult(0);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    },
    [connectionId, database, t],
  );

  const resultSets = useMemo(() => {
    if (!result) return [];
    return result.isQuery ? [...(result.results ?? []), result] : (result.results ?? []);
  }, [result]);
  const currentResult = resultSets[activeResult] ?? resultSets[resultSets.length - 1] ?? null;

  useEffect(() => {
    setResultSelected(new Set());
    setResultHidden(new Set());
  }, [currentResult]);

  const exportData = useMemo(() => {
    if (!currentResult) return { columns: [] as string[], rows: [] as unknown[][] };
    const visible = currentResult.columns
      .map((name, index) => ({ name, index }))
      .filter((c) => !resultHidden.has(c.name));
    const rows =
      resultSelected.size > 0
        ? currentResult.rows.filter((_, index) => resultSelected.has(index))
        : currentResult.rows;
    return {
      columns: visible.map((c) => c.name),
      rows: rows.map((row) => visible.map((c) => row[c.index])),
    };
  }, [currentResult, resultHidden, resultSelected]);

  const copyResult = (kind: "insert" | "csv") => {
    if (!currentResult) return;
    const text =
      kind === "insert"
        ? toINSERT(database, exportData.columns, exportData.rows)
        : toCSV(exportData.columns, exportData.rows);
    void navigator.clipboard.writeText(text).then(() => toast.success(t("structure.copied", "Copied")));
  };

  const copyProjected = (kind: "markdown" | "json" | "columns" | "where") => {
    if (!currentResult) return;
    let text = "";
    if (kind === "columns") text = exportData.columns.map((c) => `\`${c}\``).join(", ");
    else if (kind === "markdown") text = toMarkdown(exportData.columns, exportData.rows);
    else if (kind === "json")
      text = JSON.stringify(
        exportData.rows.map((row) => Object.fromEntries(exportData.columns.map((c, i) => [c, row[i]]))),
        null,
        2
      );
    else {
      const row = exportData.rows[0];
      if (!row) return;
      text = exportData.columns.map((c, i) => `\`${c}\` = ${sqlLiteralValue(row[i])}`).join("\n  AND ");
      text = "WHERE " + text;
    }
    void navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard"));
  };

  const exportResult = (kind: "csv" | "json" | "sql" | "xls") => {
    if (!currentResult) return;
    if (kind === "csv") download("result.csv", toCSV(exportData.columns, exportData.rows), "text/csv");
    else if (kind === "sql") download("result.sql", toINSERT(database, exportData.columns, exportData.rows), "application/sql");
    else if (kind === "xls") download("result.xls", toXLS(exportData.columns, exportData.rows), "application/vnd.ms-excel");
    else
      download(
        "result.json",
        JSON.stringify(
          exportData.rows.map((r) => Object.fromEntries(exportData.columns.map((c, i) => [c, r[i]]))),
          null,
          2,
        ),
        "application/json",
      );
  };

  const toggleFavorite = () => {
    if (!sql.trim()) return;
    setFavorites((prev) => {
      const next = prev.includes(sql) ? prev.filter((f) => f !== sql) : [sql, ...prev].slice(0, 50);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const togglePin = () => {
    const text = sql.trim();
    if (!text || !connectionId) return;
    if (pinnedQuery) {
      unpinQuery(pinnedQuery.id);
      toast.success(t("query.unpinned", "Unpinned from sidebar"));
      return;
    }
    pinQuery({
      sql: text,
      connectionId,
      connectionName: connection?.name ?? tab.connectionName,
      database,
    });
    toast.success(t("query.pinned", "Pinned to sidebar"));
  };

  const rowRecords = useMemo(() => {
    if (!currentResult) return [];
    return currentResult.rows.map((row) =>
      Object.fromEntries(currentResult.columns.map((c, i) => [c, row[i]])),
    );
  }, [currentResult]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Server className="h-4 w-4 text-primary" />
        <Select value={connectionId} onValueChange={(v) => { setConnectionId(v); setDatabase(""); }}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder={t("query.connection", "Connection")} />
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
            <SelectValue placeholder={t("query.database", "Database")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("query.noDatabase", "(no database)")}</SelectItem>
            {databases.map((d) => (
              <SelectItem key={d.name} value={d.name}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={String(timeoutSec)}
          onValueChange={(v) => {
            const n = Number(v);
            setTimeoutSec(n);
            localStorage.setItem(TIMEOUT_KEY, String(n));
          }}
        >
          <SelectTrigger className="h-8 w-[126px] text-xs" title={t("query.timeout", "Query timeout")}>
            <Timer className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">{t("query.timeoutNone", "No timeout")}</SelectItem>
            <SelectItem value="30">30 s</SelectItem>
            <SelectItem value="60">60 s</SelectItem>
            <SelectItem value="300">5 min</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant={snippetsOpen ? "default" : "outline"}
            onClick={() => {
              setSnippetsOpen((v) => {
                localStorage.setItem("mysqlui.snippetsOpen", v ? "0" : "1");
                return !v;
              });
            }}
            title={t("snippets.title", "SQL snippets")}
          >
            <PanelRight />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant={inTransaction ? "default" : "outline"} disabled={running || txBusy || !connectionId}>
                {txBusy ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />}
                {inTransaction ? t("query.inTransaction", "In transaction") : t("query.transaction", "Tx")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={inTransaction || running || txBusy}
                onClick={() => void transaction("START TRANSACTION")}
              >
                {t("query.begin", "Begin")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!inTransaction || running || txBusy}
                onClick={() => void transaction("COMMIT")}
              >
                {t("query.commit", "Commit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!inTransaction || running || txBusy}
                onClick={() => void transaction("ROLLBACK")}
              >
                {t("query.rollback", "Rollback")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant={builderOpen ? "default" : "outline"}
            disabled={!database}
            onClick={() => setBuilderOpen((v) => !v)}
          >
            <Hammer /> {t("query.builder", "Builder")}
          </Button>
          <Button size="sm" variant="outline" onClick={toggleFavorite} disabled={!sql.trim()}>
            <Star className={cn(favorites.includes(sql) && "fill-amber-400 text-amber-400")} />
          </Button>
          <Button
            size="sm"
            variant={pinnedQuery ? "default" : "outline"}
            onClick={togglePin}
            disabled={!sql.trim() || !connectionId}
            title={pinnedQuery ? t("query.unpin", "Unpin from sidebar") : t("query.pin", "Pin to sidebar")}
          >
            {pinnedQuery ? <PinOff /> : <Pin />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <History /> {t("query.history", "History")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-md">
              <div className="p-1">
                <input
                  className="h-7 w-full rounded border bg-background px-2 text-xs outline-none"
                  placeholder={t("query.searchHistory", "Search history")}
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value)}
                />
              </div>
              <DropdownMenuLabel>{t("query.recentQueries", "Recent queries")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {history.filter((h) => !historyFilter || h.sql.toLowerCase().includes(historyFilter.toLowerCase())).map((h) => (
                <DropdownMenuItem key={h.id} onClick={() => setSql(h.sql)} className="font-mono text-xs">
                  <span className="max-w-[360px] truncate">{h.sql.replace(/\s+/g, " ")}</span>
                  <span className="ml-auto pl-2 text-[10px] text-muted-foreground">{h.database || h.connectionName || ""}</span>
                </DropdownMenuItem>
              ))}
              {favorites.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t("app.favorites", "Favorites")}</DropdownMenuLabel>
                  {favorites.map((f, i) => (
                    <DropdownMenuItem key={`f${i}`} onClick={() => setSql(f)} className="font-mono text-xs">
                      <Star className="h-3 w-3 text-amber-400" />
                      <span className="max-w-[360px] truncate">{f.replace(/\s+/g, " ")}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setHistoryDialogOpen(true)}>
                <History /> Manage / filter history
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  clearQueryHistory();
                  setHistory([]);
                }}
              >
                <Trash2 /> {t("query.clearHistory", "Clear history")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" onClick={() => { setSql(""); setResult(null); setActiveResult(0); setError(null); }}>
            <Eraser /> {t("query.clear", "Clear")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSql(formatSQL(sql))}
            disabled={!sql.trim() || running}
            title={t("query.format", "Format")}
          >
            <Wand2 /> {t("query.format", "Format")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExplainOpen(true)} disabled={!sql.trim()}>
            <TrendingUp /> {t("explain.button", "Explain")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,.txt"
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              e.target.value = "";
              if (selected) void runFile(selected);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={running || txBusy || !connectionId}
            title={t("query.importSqlHint", "Execute a .sql file")}
          >
            <Upload /> {t("query.importSql", "Import SQL")}
          </Button>
          {running && activeRunId ? (
            <Button size="sm" variant="destructive" onClick={() => void cancel()}>
              <Square /> {t("query.cancel", "Cancel")}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => run(undefined, { cursor: selectionRef.current?.start ?? 0, all: true })}
                disabled={running || txBusy || !connectionId}
                title="Run all statements (Ctrl/Cmd+Shift+Enter)"
              >
                Run all
              </Button>
              <Button size="sm" onClick={() => run()} disabled={running || txBusy || !connectionId}>
                {running ? <Loader2 className="animate-spin" /> : <Play />} {t("query.run", "Run")}
                <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">⌘/Ctrl+↵</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
      {builderOpen && database ? (
          <div className="h-72 min-h-0 shrink-0 border-b">
            <QueryBuilder
              connectionId={connectionId}
              database={database}
              onApply={(generated) => {
                setSql(generated);
                setBuilderOpen(false);
              }}
            />
          </div>
        ) : (
          <SqlEditor
            value={sql}
            onChange={setSql}
            onRun={(selected) => void run(selected)}
            schema={schema}
            placeholder={t("query.placeholder", "SELECT * FROM users LIMIT 100;")}
            className="h-56 shrink-0 border-b"
            initialSelection={tab.initialSelection}
            revealLine={errorLine}
            onSelection={(selection) => {
              selectionRef.current = selection;
            }}
          />
        )}
  
        <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-1.5 text-xs">
          {running && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("common.loading", "Loading…")}
            </span>
          )}
          {!running && error && (
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {t("query.error", "Error")}
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
              {result.truncated && (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> {t("query.truncated", "truncated")}
                </Badge>
              )}
            </span>
          )}
          {!running && !error && !result && (
            <span className="text-muted-foreground">
              {connection ? connection.name : "—"} · {t("query.runHint", "Run a query to see results")}
            </span>
          )}
  
          {currentResult && currentResult.isQuery && currentResult.rowCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                variant={view === "chart" ? "default" : "outline"}
                onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
                title={t("chart.title", "Chart")}
              >
                {view === "chart" ? <Table2 /> : <BarChart3 />}
                {view === "chart" ? t("chart.viewTable", "Table") : t("chart.viewChart", "Chart")}
              </Button>
              <Button size="icon-sm" variant="ghost" title={t("query.copyInsert", "Copy as INSERT")} onClick={() => copyResult("insert")}>
                <Copy />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Download /> {t("table.export", "Export")}
                    {resultSelected.size > 0 ? ` (${resultSelected.size})` : ""}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                    {resultSelected.size > 0
                      ? `Selected rows and visible columns only`
                      : `All rows and ${exportData.columns.length} visible column(s)`}
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => exportResult("csv")}>
                    <FileSpreadsheet /> {t("query.exportCsv", "CSV")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportResult("json")}>
                    <FileJson /> {t("query.exportJson", "JSON")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportResult("sql")}>
                    <FileText /> SQL (INSERT)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportResult("xls")}>
                    <FileSpreadsheet /> Excel
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => copyResult("csv")}>
                    <Copy /> {t("query.copyCsv", "Copy as CSV")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copyProjected("markdown")}>
                    <Copy /> Copy as Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copyProjected("json")}>
                    <Copy /> Copy as JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copyProjected("columns")}>
                    <Copy /> Copy column names
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copyProjected("where")}>
                    <Copy /> Copy first row as WHERE
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
  
        {resultSets.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b bg-muted/10 px-3 py-1.5">
            <span className="mr-1 shrink-0 text-xs text-muted-foreground">
              {t("query.resultSets", "Results")}
            </span>
            {resultSets.map((rs, i) => (
              <Button
                key={i}
                size="sm"
                variant={i === activeResult ? "default" : "outline"}
                className="h-6 shrink-0 px-2 text-xs"
                onClick={() => setActiveResult(i)}
              >
                #{i + 1} · {formatNumber(rs.rowCount)}
              </Button>
            ))}
          </div>
        )}
  
        <div className="min-h-0 flex-1">
          {error ? (
            <div className="h-full overflow-auto p-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-[13px] text-destructive">
                {errorLine && (
                  <div className="mb-2 flex items-center gap-2 font-sans text-xs">
                    <AlertTriangle className="h-3.5 w-3.5" /> Error near line {errorLine}. The editor was moved there.
                  </div>
                )}
                {error}
              </div>
            </div>
          ) : currentResult?.isQuery ? (
            view === "chart" ? (
              <ChartView
                rows={rowRecords}
                columns={currentResult.columns}
                storageKey={`query:${connectionId}:${database}:${activeResult}`}
              />
            ) : (
              <ResultGrid
                columns={currentResult.columns}
                rows={currentResult.rows}
                selected={resultSelected}
                onSelectedChange={setResultSelected}
                hidden={resultHidden}
                onHiddenChange={setResultHidden}
              />
            )
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
                {t("query.runHint", "Run a query to see results")}
              </div>
            </div>
          )}
        </div>
  
          </div>
        <SnippetPanel
          open={snippetsOpen}
          onClose={() => {
            setSnippetsOpen(false);
            localStorage.setItem("mysqlui.snippetsOpen", "0");
          }}
          currentSql={sql}
          connectionName={connection?.name ?? tab.connectionName}
          database={database}
        />
      </div>

      <QueryHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        items={history}
        favorites={favorites}
        onRun={(text) => {
          setSql(text);
          setHistoryDialogOpen(false);
        }}
        onCopy={(text) => void navigator.clipboard.writeText(text).then(() => toast.success("SQL copied"))}
        onPin={(item) => {
          pinQuery({
            sql: item.sql,
            connectionId: item.connectionId ?? connectionId,
            connectionName: item.connectionName ?? connection?.name ?? tab.connectionName,
            database: item.database ?? database,
          });
          toast.success(t("query.pinned", "Pinned to sidebar"));
        }}
        onDelete={(id) => setHistory((prev) => removeQueryHistory(prev, id))}
        onClear={() => {
          clearQueryHistory();
          setHistory([]);
        }}
      />

      <ParameterDialog
        open={paramRequest !== null}
        onOpenChange={(open) => {
          if (!open) setParamRequest(null);
        }}
        sql={paramRequest?.sql ?? ""}
        names={paramRequest?.names ?? []}
        connectionName={connection?.name ?? tab.connectionName}
        database={database}
        onRun={(expanded) => {
          const startLine = paramRequest?.startLine ?? 1;
          setParamRequest(null);
          assessAndRun(expanded, startLine);
        }}
      />

      <RiskDialog
        open={riskRequest !== null}
        sql={riskRequest?.text ?? ""}
        risks={riskRequest?.risks ?? []}
        estimatedRows={riskRequest?.estimatedRows ?? null}
        estimating={riskRequest?.estimating ?? false}
        threshold={riskThreshold}
        onCancel={() => setRiskRequest(null)}
        onRun={() => {
          const request = riskRequest;
          setRiskRequest(null);
          if (request) void runRaw(request.text, request.startLine);
        }}
      />

      <ExplainDialog
        open={explainOpen}
        onOpenChange={setExplainOpen}
        connectionId={connectionId}
        database={database}
        sql={sql}
      />
    </div>
  );
}
