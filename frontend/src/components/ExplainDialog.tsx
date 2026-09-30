import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import type { QueryResult } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JsonView } from "@/components/JsonView";
import { ResultGrid } from "@/components/ResultGrid";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  database: string;
  sql: string;
}

interface TablePlan {
  name: string;
  accessType: string;
  rowsExamined?: number;
  rowsProduced?: number;
  key?: string;
}

function collectTables(block: unknown, out: TablePlan[]) {
  if (!block || typeof block !== "object") return;
  const obj = block as Record<string, unknown>;
  const table = obj.table;
  if (table && typeof table === "object") {
    const t = table as Record<string, unknown>;
    out.push({
      name: typeof t.table_name === "string" ? t.table_name : "?",
      accessType: typeof t.access_type === "string" ? t.access_type : "",
      rowsExamined: typeof t.rows_examined_per_scan === "number" ? t.rows_examined_per_scan : undefined,
      rowsProduced: typeof t.rows_produced_per_join === "number" ? t.rows_produced_per_join : undefined,
      key: typeof t.key === "string" ? t.key : undefined,
    });
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") collectTables(value, out);
  }
}

function summarize(plan: Record<string, unknown> | null): { cost: number | null; tables: TablePlan[] } {
  if (!plan) return { cost: null, tables: [] };
  const block = plan.query_block;
  let cost: number | null = null;
  if (block && typeof block === "object") {
    const costInfo = (block as Record<string, unknown>).cost_info;
    if (costInfo && typeof costInfo === "object") {
      const raw = (costInfo as Record<string, unknown>).query_cost;
      const n = Number(raw);
      if (Number.isFinite(n)) cost = n;
    }
  }
  const tables: TablePlan[] = [];
  collectTables(block, tables);
  return { cost, tables };
}

export function ExplainDialog({ open, onOpenChange, connectionId, database, sql }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);
  const [fallback, setFallback] = useState<QueryResult | null>(null);

  const run = useCallback(async () => {
    const text = sql.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    setPlan(null);
    setFallback(null);
    try {
      const res = await api.runQuery(connectionId, database, `EXPLAIN FORMAT=JSON ${text}`);
      const cell = res.rows?.[0]?.[0];
      const raw = typeof cell === "string" ? cell : JSON.stringify(cell);
      try {
        setPlan(JSON.parse(raw) as Record<string, unknown>);
        return;
      } catch {
        /* not JSON: fall through to the tabular plan */
      }
      const tabular = await api.runQuery(connectionId, database, `EXPLAIN ${text}`);
      setFallback(tabular);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId, database, sql]);

  useEffect(() => {
    if (open) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { cost, tables } = summarize(plan);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("explain.title", "Execution plan")}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            EXPLAIN FORMAT=JSON · {sql.replace(/\s+/g, " ").slice(0, 120)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-3 py-2">
          <Button variant="outline" size="sm" disabled={loading || !sql.trim()} onClick={() => void run()}>
            {loading ? <Loader2 className="animate-spin" /> : <Play />}
            {t("explain.rerun", "Run again")}
          </Button>
          {cost !== null && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              {t("explain.queryCost", "Query cost")}: <span className="font-mono text-foreground">{cost}</span>
            </span>
          )}
          {tables.map((table, i) => (
            <Badge key={`${table.name}-${i}`} variant="secondary" className="gap-1 font-mono text-[11px]">
              {table.name}
              {table.accessType ? ` · ${table.accessType}` : ""}
              {table.rowsExamined !== undefined ? ` · rows ${table.rowsExamined}` : ""}
            </Badge>
          ))}
        </div>

        <div className="mt-1 min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 font-mono text-[13px] text-destructive">
              {error}
            </div>
          ) : plan ? (
            <JsonView value={plan} maxHeight="none" />
          ) : fallback ? (
            <div className="h-[50vh]">
              <ResultGrid columns={fallback.columns} rows={fallback.rows} />
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              {t("explain.empty", "Run a query to see its plan.")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
