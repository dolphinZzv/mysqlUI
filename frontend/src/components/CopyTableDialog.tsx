import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyPlus, Database as DatabaseIcon, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DatabaseInfo } from "@/lib/types";
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
  onDone?: () => void;
}

export function CopyTableDialog({ open, onOpenChange, connectionId, database, table, onDone }: Props) {
  const { t } = useI18n();
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [targetDatabase, setTargetDatabase] = useState(database);
  const [targetTable, setTargetTable] = useState(`${table}_copy`);
  const [dropTarget, setDropTarget] = useState(false);
  const [copyData, setCopyData] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetDatabase(database);
    setTargetTable(`${table}_copy`);
    setDropTarget(false);
    setCopyData(true);
    api
      .listDatabases(connectionId)
      .then(setDatabases)
      .catch(() => setDatabases([]));
  }, [open, connectionId, database, table]);

  const submit = async () => {
    if (!targetDatabase || !targetTable.trim()) {
      toast.error(t("copyTable.required", "Target database and table name are required"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.copyTable(connectionId, database, table, {
        targetDatabase,
        targetTable: targetTable.trim(),
        dropTarget,
        copyData,
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
            {t("copyTable.copyData", "Copy data (INSERT ... SELECT)")}
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
