import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Activity, Gauge, Loader2, RefreshCw, Search, Skull, X } from "lucide-react";
import { api } from "@/lib/api";
import type { MonitorOverview, NameValue, ProcessInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

export function MonitorTab({ connectionId }: Props) {
  const { t } = useI18n();
  const [overview, setOverview] = useState<MonitorOverview | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [status, setStatus] = useState<NameValue[]>([]);
  const [variables, setVariables] = useState<NameValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState("");
  const [killTarget, setKillTarget] = useState<ProcessInfo | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, pl] = await Promise.all([api.monitorOverview(connectionId), api.processList(connectionId)]);
      setOverview(ov);
      setProcesses(pl);
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
    }, 5000);
    return () => window.clearInterval(id);
  }, [autoRefresh, connectionId]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Gauge className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t("monitor.overview", "Overview")}</span>
        {overview && <Badge variant="outline">{overview.version}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
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
          </TabsList>

          <TabsContent value="processes" className="mt-3">
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
                  {processes.map((p) => (
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
            <KVList items={filterKV(variables)} />
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

function KVList({ items }: { items: NameValue[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-[12px]">
        <tbody>
          {items.map((v) => (
            <tr key={v.name} className="border-t first:border-0 hover:bg-muted/30">
              <td className="w-1/3 px-3 py-1 font-mono text-sky-400">{v.name}</td>
              <td className="px-3 py-1 font-mono break-all text-muted-foreground">{v.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
