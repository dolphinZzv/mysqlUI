import { useEffect, useState } from "react";
import { Database, HardDrive, Loader2, RefreshCw, Table2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DatabaseStats } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TableStats {
  rows: number;
  dataLength: number;
  indexLength: number;
  autoIncrement: number;
  engine: string;
  collation: string;
  comment: string;
  createTime: string;
  updateTime: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  database: string;
  table?: string;
}

function bytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function StatsDialog({ open, onOpenChange, connectionId, database, table }: Props) {
  const [tableStats, setTableStats] = useState<TableStats | null>(null);
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [dbResult, tableResult] = await Promise.allSettled([
      api.databaseStats(connectionId, database),
      table ? api.tableStats(connectionId, database, table) : Promise.resolve(null),
    ]);
    setDbStats(dbResult.status === "fulfilled" ? dbResult.value : null);
    setTableStats(tableResult.status === "fulfilled" ? tableResult.value : null);
    const errors = [dbResult, tableResult]
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    setError(errors.length ? errors.join(" · ") : null);
    setLoading(false);
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId, database, table]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" /> Capacity statistics
          </DialogTitle>
          <DialogDescription>
            {database}
            {table ? `.${table}` : ""} · values come from information_schema and may be approximate for InnoDB.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
                Some statistics are unavailable (missing privileges degrade gracefully): {error}
              </div>
            )}
            {tableStats && (
              <section className="rounded-lg border">
                <h3 className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium">
                  <Table2 className="h-3.5 w-3.5" /> {table}
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-sm sm:grid-cols-3">
                  <Stat label="Rows" value={formatNumber(tableStats.rows)} />
                  <Stat label="Data size" value={bytes(tableStats.dataLength)} />
                  <Stat label="Index size" value={bytes(tableStats.indexLength)} />
                  <Stat label="Engine" value={tableStats.engine || "—"} />
                  <Stat label="Collation" value={tableStats.collation || "—"} />
                  <Stat label="Auto increment" value={tableStats.autoIncrement ? formatNumber(tableStats.autoIncrement) : "—"} />
                  <Stat label="Created" value={tableStats.createTime || "—"} />
                  <Stat label="Updated" value={tableStats.updateTime || "—"} />
                  <Stat label="Comment" value={tableStats.comment || "—"} />
                </div>
              </section>
            )}
            {dbStats && (
              <section className="rounded-lg border">
                <h3 className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium">
                  <Database className="h-3.5 w-3.5" /> {database} totals
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-sm sm:grid-cols-3">
                  <Stat label="Tables" value={formatNumber(dbStats.tables)} />
                  <Stat label="Rows" value={formatNumber(dbStats.rows)} />
                  <Stat label="Data size" value={bytes(dbStats.dataLength)} />
                  <Stat label="Index size" value={bytes(dbStats.indexLength)} />
                  <Stat label="Free space" value={bytes(dbStats.freeLength)} />
                  <Stat label="Charset" value={dbStats.charset || "—"} />
                  <Stat label="Collation" value={dbStats.collation || "—"} />
                </div>
              </section>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-[12px]" title={value}>
        {value}
      </div>
    </div>
  );
}
