import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyPlus, Database as DatabaseIcon, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Connection, DatabaseInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  database: string;
  table: string;
  connections: Connection[];
  onDone?: () => void;
}

export function CopyTableDialog({ open, onOpenChange, connectionId, database, table, connections, onDone }: Props) {
  const { t } = useI18n();
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [targetConnectionId, setTargetConnectionId] = useState(connectionId);
  const [targetDatabase, setTargetDatabase] = useState(database);
  const [targetTable, setTargetTable] = useState(`${table}_copy`);
  const [dropTarget, setDropTarget] = useState(false);
  const [copyData, setCopyData] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetConnectionId(connectionId);
    setTargetDatabase(database);
    setTargetTable(`${table}_copy`);
    setDropTarget(false);
    setCopyData(true);
  }, [open, connectionId, database, table]);

  useEffect(() => {
    if (!open || !targetConnectionId) return;
    api
      .listDatabases(targetConnectionId)
      .then((list) => {
        setDatabases(list);
        if (!list.some((d) => d.name === targetDatabase)) {
          setTargetDatabase(list.find((d) => !d.isSystem)?.name ?? "");
        }
      })
      .catch(() => setDatabases([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetConnectionId]);

  const submit = async () => {
    if (!targetConnectionId || !targetDatabase || !targetTable.trim()) {
      toast.error(t("copyTable.required", "Target connection, database and table name are required"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.crossCopyTable({
        sourceConnectionId: connectionId,
        sourceDatabase: database,
        sourceTable: table,
        targetConnectionId,
        targetDatabase,
        targetTable: targetTable.trim(),
        dropTarget,
        copyData,
        copyStructure: true,
      });
      toast.success(
        copyData
          ? t("copyTable.copiedRows", `Copied {rows} row(s) to {target}`, { rows: res.rowsCopied, target: res.target })
          : t("copyTable.copied", `Table copied to {target}`, { target: res.target })
      );
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CopyPlus className="h-4 w-4 text-primary" />
            {t("copyTable.title", "Copy table")}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {database}.{table}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label>Target connection</Label>
            <Select value={targetConnectionId} onValueChange={setTargetConnectionId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>{t("copyTable.targetDatabase", "Target database")}</Label>
            <Select value={targetDatabase} onValueChange={setTargetDatabase}>
              <SelectTrigger>
                <DatabaseIcon className="mr-1 h-3.5 w-3.5 text-sky-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {databases.map((d) => (
                  <SelectItem key={d.name} value={d.name}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="target-table">{t("copyTable.targetTable", "Target table")}</Label>
            <Input
              id="target-table"
              value={targetTable}
              onChange={(e) => setTargetTable(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
            <Checkbox checked={copyData} onCheckedChange={(v) => setCopyData(Boolean(v))} />
            Copy table data
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
            <Checkbox checked={dropTarget} onCheckedChange={(v) => setDropTarget(Boolean(v))} />
            {t("copyTable.dropTarget", "Drop target table first if it exists")}
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <CopyPlus />}
            {t("copyTable.submit", "Copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
