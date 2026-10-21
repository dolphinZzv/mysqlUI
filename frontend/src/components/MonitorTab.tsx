import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Activity, Copy, Gauge, GitBranch, Loader2, Pencil, RefreshCw, Search, Skull, Timer, X } from "lucide-react";
import { api } from "@/lib/api";
import type { MonitorOverview, NameValue, ProcessInfo, ReplicationStatus, SlowQueryInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  connectionId: string;
}

function formatUptime(seconds: number): string {
  if (!seconds) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d ? `${d}d` : "", h ? `${h}h` : "", `${m}m`].filter(Boolean).join(" ");
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const REFRESH_KEY = "mysqlui.monitor.interval";
const AUTO_KEY = "mysqlui.monitor.auto";

export function MonitorTab({ connectionId }: Props) {
  const { t } = useI18n();
  const [overview, setOverview] = useState<MonitorOverview | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [status, setStatus] = useState<NameValue[]>([]);
  const [variables, setVariables] = useState<NameValue[]>([]);
  const [replication, setReplication] = useState<ReplicationStatus | null>(null);
  const [slow, setSlow] = useState<SlowQueryInfo | null>(null);
  const [editVar, setEditVar] = useState<{ name: string; value: string; scope: "GLOBAL" | "SESSION" } | null>(null);
  const [varBusy, setVarBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(() => localStorage.getItem(AUTO_KEY) !== "0");
  const [refreshInterval, setRefreshInterval] = useState(() => {
    const stored = Number(localStorage.getItem(REFRESH_KEY));
    return [2, 5, 10, 30].includes(stored) ? stored : 5;
  });
  const [processView, setProcessView] = useState<"all" | "running" | "locked" | "slow">("all");
  const [filter, setFilter] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [slowFilter, setSlowFilter] = useState("");
  const [killTarget, setKillTarget] = useState<ProcessInfo | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, pl, rep, slowInfo] = await Promise.all([
        api.monitorOverview(connectionId),
        api.processList(connectionId),
        api.replicationStatus(connectionId).catch(() => ({
          role: "unknown",
          master: [],
          replica: [],
          replicas: [],
          error: "Unable to load replication status",
        })),
        api.slowQueries(connectionId).catch(() => ({
          enabled: false,
          longQueryTime: 0,
          logFile: "",
          rows: [],
          error: "Unable to load slow query data",
        })),
      ]);
      setOverview(ov);
      setProcesses(pl);
      setReplication(rep);
      setSlow(slowInfo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void refresh();
    api.monitorStatus(connectionId).then(setStatus).catch(() => {});
    api.monitorVariables(connectionId).then(setVariables).catch(() => {});
  }, [connectionId, refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      api.processList(connectionId).then(setProcesses).catch(() => {});
      api.monitorOverview(connectionId).then(setOverview).catch(() => {});
    }, refreshInterval * 1000);
    return () => window.clearInterval(id);
  }, [autoRefresh, connectionId, refreshInterval]);

  const kill = async (queryOnly: boolean) => {
    if (!killTarget) return;
    try {
      await api.killProcess(connectionId, killTarget.id, queryOnly);
      toast.success(t("monitor.killed", "Process terminated"));
      setKillTarget(null);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const stats = useMemo(() => {
    if (!overview) return [];
    return [
      { label: t("monitor.uptime", "Uptime"), value: formatUptime(overview.uptime) },
      { label: t("monitor.qps", "QPS"), value: overview.qps.toFixed(1) },
      {
        label: t("monitor.threads", "Threads (conn/run)"),
        value: `${formatNumber(overview.threadsConnected)} / ${formatNumber(overview.threadsRunning)}`,
      },
      { label: t("monitor.questions", "Total queries"), value: formatNumber(overview.questions) },
      { label: t("monitor.slow", "Slow queries"), value: formatNumber(overview.slowQueries) },
      {
        label: t("monitor.bytes", "Bytes in / out"),
        value: `${formatBytes(overview.bytesReceived)} / ${formatBytes(overview.bytesSent)}`,
      },
      { label: "InnoDB buffer pool", value: formatBytes(overview.innodbBufferPoolSize) },
      { label: "Aborted connects", value: formatNumber(overview.abortedConnects) },
    ];
  }, [overview, t]);

  const filterKV = (list: NameValue[]) =>
    filter ? list.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase())) : list;

  const saveVariable = async () => {
    if (!editVar) return;
    setVarBusy(true);
    try {
      await api.setMonitorVariable(connectionId, editVar.name, editVar.scope, editVar.value);
      toast.success("Variable updated");
      setEditVar(null);
      const next = await api.monitorVariables(connectionId);
      setVariables(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setVarBusy(false);
    }
  };

  const filteredProcesses = useMemo(() => {
    const q = processFilter.toLowerCase();
    return processes.filter((p) => {
      if (processView === "running" && p.command === "Sleep") return false;
      if (processView === "locked" && !/lock|wait/i.test(`${p.state} ${p.info}`)) return false;
      if (processView === "slow" && Number(p.time) < 5) return false;
      return !q || [p.user, p.db, p.command, p.state, p.info].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [processes, processFilter, processView]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Gauge className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t("monitor.overview", "Overview")}</span>
        {overview && <Badge variant="outline">{overview.version}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={String(refreshInterval)}
            onValueChange={(value) => {
              const n = Number(value);
              setRefreshInterval(n);
              localStorage.setItem(REFRESH_KEY, String(n));
            }}
          >
            <SelectTrigger className="h-7 w-[92px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2, 5, 10, 30].map((seconds) => (
                <SelectItem key={seconds} value={String(seconds)}>
                  every {seconds}s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => {
                setAutoRefresh(e.target.checked);
                localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0");
              }}
              className="accent-primary"
            />
            auto
          </label>
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("monitor.refresh", "Refresh")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>

        <Tabs defaultValue="processes">
          <TabsList className="h-8">
            <TabsTrigger value="processes" className="text-xs">
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              {t("monitor.processes", "Processes")} ({processes.length})
            </TabsTrigger>
            <TabsTrigger value="status" className="text-xs">
              {t("monitor.status", "Status")}
            </TabsTrigger>
            <TabsTrigger value="variables" className="text-xs">
              {t("monitor.variables", "Variables")}
            </TabsTrigger>
            <TabsTrigger value="replication" className="text-xs">
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              {t("monitor.replication", "Replication")}
            </TabsTrigger>
            <TabsTrigger value="slow" className="text-xs">
              <Timer className="mr-1.5 h-3.5 w-3.5" />
              {t("monitor.slowQueries", "Slow queries")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="processes" className="mt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-8 w-[280px] pl-8 text-xs" placeholder="Filter by user, database, command or SQL" value={processFilter} onChange={(e) => setProcessFilter(e.target.value)} />
              </div>
              {(["all", "running", "locked", "slow"] as const).map((view) => (
                <Button
                  key={view}
                  size="sm"
                  variant={processView === view ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setProcessView(view)}
                >
                  {view === "all" ? "All" : view === "running" ? "Running" : view === "locked" ? "Locks / waits" : "Slow (≥5s)"}
                </Button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">{filteredProcesses.length} shown</span>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t("monitor.id", "ID")}</th>
                    <th className="px-2 py-2 font-medium">{t("monitor.user", "User")}</th>
                    <th className="px-2 py-2 font-medium">{t("monitor.db", "DB")}</th>
                    <th className="px-2 py-2 font-medium">{t("monitor.command", "Command")}</th>
                    <th className="px-2 py-2 font-medium">{t("monitor.time", "Time")}</th>
                    <th className="px-2 py-2 font-medium">{t("monitor.state", "State")}</th>
                    <th className="px-2 py-2 font-medium">{t("monitor.info", "SQL")}</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredProcesses.map((p) => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="px-2 py-1.5 font-mono text-muted-foreground">{p.id}</td>
                      <td className="px-2 py-1.5">{p.user}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{p.db}</td>
                      <td className="px-2 py-1.5">{p.command}</td>
                      <td className="px-2 py-1.5 tabular-nums">{p.time}s</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{p.state}</td>
                      <td className="max-w-[420px] px-2 py-1.5">
                        <span className="block truncate font-mono text-[11px] text-muted-foreground" title={p.info}>
                          {p.info}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {p.command !== "Sleep" && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="hover:text-destructive"
                            title={t("monitor.kill", "Kill")}
                            onClick={() => setKillTarget(p)}
                          >
                            <Skull />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="status" className="mt-3">
            <KVList items={filterKV(status)} />
          </TabsContent>
          <TabsContent value="variables" className="mt-3">
            <KVList
              items={filterKV(variables)}
              onEdit={(item) => setEditVar({ name: item.name, value: item.value, scope: "GLOBAL" })}
            />
          </TabsContent>
          <TabsContent value="replication" className="mt-3">
            <ReplicationView data={replication} />
          </TabsContent>
          <TabsContent value="slow" className="mt-3">
            <SlowQueriesView data={slow} filter={slowFilter} onFilter={setSlowFilter} />
          </TabsContent>
        </Tabs>

        {(status.length > 0 || variables.length > 0) && (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-9 text-xs"
              placeholder={t("monitor.filter", "Filter variables")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setFilter("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <Dialog open={editVar !== null} onOpenChange={(o) => !o && setEditVar(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">{editVar?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Scope</Label>
              <Select value={editVar?.scope ?? "GLOBAL"} onValueChange={(v) => setEditVar((s) => (s ? { ...s, scope: v as "GLOBAL" | "SESSION" } : s))}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GLOBAL">GLOBAL</SelectItem>
                  <SelectItem value="SESSION">SESSION</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Value</Label>
              <Input className="h-8 font-mono" value={editVar?.value ?? ""} onChange={(e) => setEditVar((s) => (s ? { ...s, value: e.target.value } : s))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditVar(null)} disabled={varBusy}>Cancel</Button>
            <Button onClick={() => void saveVariable()} disabled={varBusy}>
              {varBusy ? <Loader2 className="animate-spin" /> : <Pencil />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={killTarget !== null} onOpenChange={(o) => !o && setKillTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("monitor.killConfirm", "Terminate this process?")}</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs">
              ID {killTarget?.id} · {killTarget?.user}@{killTarget?.host}
              <br />
              {killTarget?.info}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-end">
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <Button variant="outline" onClick={() => void kill(true)}>
              {t("monitor.killQuery", "Kill query")}
            </Button>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void kill(false)}
            >
              {t("monitor.kill", "Kill connection")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function objectValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function MapTable({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">{title}</div>
      {rows.map((row, i) => (
        <div key={i} className="mb-2 overflow-hidden rounded-lg border">
          <table className="w-full text-[12px]">
            <tbody>
              {Object.entries(row).map(([k, v]) => (
                <tr key={k} className="border-t first:border-0 hover:bg-muted/30">
                  <td className="w-1/3 px-3 py-1 font-mono text-sky-400">{k}</td>
                  <td className="px-3 py-1 font-mono break-all text-muted-foreground">{objectValue(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ReplicationView({ data }: { data: ReplicationStatus | null }) {
  const { t } = useI18n();
  if (!data) {
    return <div className="p-6 text-center text-sm text-muted-foreground">{t("common.loading", "Loading…")}</div>;
  }
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("monitor.role", "Role")}</span>
        <Badge variant={data.role === "replica" ? "warning" : data.role === "primary" ? "success" : "secondary"}>
          {data.role}
        </Badge>
      </div>
      {data.error && <p className="mb-3 break-all text-xs text-destructive">{data.error}</p>}
      {data.role === "standalone" && !data.error && (
        <p className="mb-3 text-sm text-muted-foreground">{t("monitor.noReplication", "No replication is configured.")}</p>
      )}
      <MapTable title={t("monitor.masterStatus", "Primary / binary log")} rows={data.master} />
      <MapTable title={t("monitor.replicaStatus", "Replica status")} rows={data.replica} />
      <MapTable title={t("monitor.replicas", "Connected replicas")} rows={data.replicas} />
    </div>
  );
}

function slowNumber(v: unknown): string {
  if (typeof v === "number") return formatNumber(Math.round(v));
  if (v === null || v === undefined) return "-";
  return String(v);
}

function SlowQueriesView({ data, filter, onFilter }: { data: SlowQueryInfo | null; filter: string; onFilter: (v: string) => void }) {
  const { t } = useI18n();
  if (!data) {
    return <div className="p-6 text-center text-sm text-muted-foreground">{t("common.loading", "Loading…")}</div>;
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={data.enabled ? "success" : "secondary"}>
          slow_query_log {data.enabled ? "ON" : "OFF"}
        </Badge>
        <Badge variant="outline">long_query_time {data.longQueryTime}s</Badge>
        {data.logFile && <span className="font-mono text-muted-foreground">{data.logFile}</span>}
      </div>
      {data.error && <p className="mb-3 break-all text-xs text-destructive">{data.error}</p>}
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-8 pl-8 text-xs" placeholder="Filter slow queries" value={filter} onChange={(e) => onFilter(e.target.value)} />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">SQL digest</th>
              <th className="px-2 py-2 font-medium">Count</th>
              <th className="px-2 py-2 font-medium">Avg ms</th>
              <th className="px-2 py-2 font-medium">Max ms</th>
              <th className="px-2 py-2 font-medium">Rows examined</th>
              <th className="px-2 py-2 font-medium">Rows sent</th>
              <th className="px-2 py-2 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.filter((row) => !filter || String(row.DIGEST_TEXT ?? "").toLowerCase().includes(filter.toLowerCase())).map((row, i) => (
              <tr key={i} className="border-t hover:bg-muted/30">
                <td className="max-w-[520px] px-2 py-1.5 font-mono text-[11px]">
                  <span className="block truncate" title={String(row.DIGEST_TEXT ?? "")}>
                    {String(row.DIGEST_TEXT ?? "")}
                  </span>
                </td>
                <td className="px-2 py-1.5 tabular-nums">{slowNumber(row.COUNT_STAR)}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {typeof row.AVG_TIMER_WAIT_MS === "number" ? row.AVG_TIMER_WAIT_MS.toFixed(2) : "-"}
                </td>
                <td className="px-2 py-1.5 tabular-nums">
                  {typeof row.MAX_TIMER_WAIT_MS === "number" ? row.MAX_TIMER_WAIT_MS.toFixed(2) : "-"}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{slowNumber(row.SUM_ROWS_EXAMINED)}</td>
                <td className="px-2 py-1.5 tabular-nums">{slowNumber(row.SUM_ROWS_SENT)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{String(row.LAST_SEEN ?? "-")}</td>
                <td className="px-2 py-1.5 text-right">
                  <Button size="icon-sm" variant="ghost" title="Copy SQL" onClick={() => void navigator.clipboard.writeText(String(row.DIGEST_TEXT ?? "")).then(() => toast.success("Copied"))}>
                    <Copy />
                  </Button>
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && !data.error && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {t("monitor.noSlowQueries", "No statement digests available.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KVList({ items, onEdit }: { items: NameValue[]; onEdit?: (item: NameValue) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-[12px]">
        <tbody>
          {items.map((v) => (
            <tr key={v.name} className="border-t first:border-0 hover:bg-muted/30">
              <td className="w-1/3 px-3 py-1 font-mono text-sky-400">{v.name}</td>
              <td className="px-3 py-1 font-mono break-all text-muted-foreground">{v.value}</td>
              {onEdit && (
                <td className="w-8 px-1 py-1 text-right">
                  <Button size="icon-sm" variant="ghost" onClick={() => onEdit(v)} title="Edit">
                    <Pencil />
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
