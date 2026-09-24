import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Braces, FunctionSquare, Loader2, RefreshCw, Trash2, Zap } from "lucide-react";
import { api } from "@/lib/api";
import type { EventInfo, RoutineInfo, TriggerInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  connectionId: string;
  database: string;
}

type DropTarget = { kind: "routine" | "trigger" | "event"; name: string; type?: string } | null;

export function RoutinesView({ connectionId, database }: Props) {
  const { t } = useI18n();
  const [routines, setRoutines] = useState<RoutineInfo[]>([]);
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [ddl, setDdl] = useState<{ title: string; sql: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, tr, e] = await Promise.all([
        api.listRoutines(connectionId, database),
        api.listTriggers(connectionId, database),
        api.listEvents(connectionId, database),
      ]);
      setRoutines(r);
      setTriggers(tr);
      setEvents(e);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    void load();
  }, [load]);

  const showDefinition = async (kind: "routine" | "trigger" | "event", type: string, name: string) => {
    try {
      const res = await api.definition(connectionId, database, kind, type, name);
      setDdl({ title: name, sql: res.ddl });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDrop = async () => {
    if (!dropTarget) return;
    try {
      if (dropTarget.kind === "routine") {
        await api.dropRoutine(connectionId, database, dropTarget.type ?? "PROCEDURE", dropTarget.name);
      } else if (dropTarget.kind === "trigger") {
        await api.dropTrigger(connectionId, database, dropTarget.name);
      } else {
        await api.dropEvent(connectionId, database, dropTarget.name);
      }
      toast.success(t("common.delete", "Deleted"));
      setDropTarget(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setDropTarget(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Braces className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t("tab.routines", "Routines")}</span>
        <span className="font-mono text-xs text-muted-foreground">{database}</span>
        <Button className="ml-auto" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t("common.refresh", "Refresh")}
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4">
        <Tabs defaultValue="routines">
          <TabsList className="h-8">
            <TabsTrigger value="routines" className="text-xs">
              <FunctionSquare className="mr-1.5 h-3.5 w-3.5" />
              {t("sidebar.routines", "Procedures / Functions")} ({routines.length})
            </TabsTrigger>
            <TabsTrigger value="triggers" className="text-xs">
              {t("sidebar.triggers", "Triggers")} ({triggers.length})
            </TabsTrigger>
            <TabsTrigger value="events" className="text-xs">
              <Zap className="mr-1.5 h-3.5 w-3.5" />
              {t("sidebar.events", "Events")} ({events.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="routines" className="mt-3">
            <SimpleTable
              head={["Name", "Type", "Returns", "Definer", "Security"]}
              rows={routines.map((r) => [
                <button className="font-mono text-sky-400 hover:underline" onClick={() => void showDefinition("routine", r.type, r.name)}>
                  {r.name}
                </button>,
                <Badge variant={r.type === "FUNCTION" ? "success" : "secondary"} className="text-[10px]">{r.type}</Badge>,
                r.returns,
                r.definer,
                r.security,
              ])}
              onDelete={(i) => setDropTarget({ kind: "routine", name: routines[i].name, type: routines[i].type })}
            />
          </TabsContent>

          <TabsContent value="triggers" className="mt-3">
            <SimpleTable
              head={["Name", "Timing", "Event", "Table", "Definer"]}
              rows={triggers.map((tr) => [
                <button className="font-mono text-sky-400 hover:underline" onClick={() => void showDefinition("trigger", "TRIGGER", tr.name)}>
                  {tr.name}
                </button>,
                tr.timing,
                tr.event,
                <span className="font-mono">{tr.table}</span>,
                tr.definer,
              ])}
              onDelete={(i) => setDropTarget({ kind: "trigger", name: triggers[i].name })}
            />
          </TabsContent>

          <TabsContent value="events" className="mt-3">
            <SimpleTable
              head={["Name", "Status", "Interval", "Starts", "Definer"]}
              rows={events.map((e) => [
                <button className="font-mono text-sky-400 hover:underline" onClick={() => void showDefinition("event", "EVENT", e.name)}>
                  {e.name}
                </button>,
                <Badge variant={e.status === "ENABLED" ? "success" : "secondary"} className="text-[10px]">{e.status}</Badge>,
                e.interval,
                e.starts,
                e.definer,
              ])}
              onDelete={(i) => setDropTarget({ kind: "event", name: events[i].name })}
            />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={ddl !== null} onOpenChange={(o) => !o && setDdl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono">{ddl?.title}</DialogTitle>
          </DialogHeader>
          <pre className="scrollbar-thin max-h-[60vh] overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-[12px] leading-relaxed">
            {ddl?.sql}
          </pre>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dropTarget !== null} onOpenChange={(o) => !o && setDropTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" /> DROP {dropTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>{t("structure.dropTableDesc", "This cannot be undone.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDrop}
            >
              {t("common.delete", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SimpleTable({
  head,
  rows,
  onDelete,
}: {
  head: string[];
  rows: React.ReactNode[][];
  onDelete: (index: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t hover:bg-muted/30">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5">
                  {cell}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right">
                <Button size="icon-sm" variant="ghost" className="hover:text-destructive" onClick={() => onDelete(i)}>
                  <Trash2 />
                </Button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                —
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
