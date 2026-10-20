import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, GitCompare, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DataDiffResult, DatabaseInfo, TableInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  database: string;
  table: string;
}

export function DataDiffDialog({ open, onOpenChange, connectionId, database, table }: Props) {
  const { t } = useI18n();
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [targetDatabase, setTargetDatabase] = useState(database);
  const [targetTable, setTargetTable] = useState("");
  const [result, setResult] = useState<DataDiffResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setTargetDatabase(database);
    setTargetTable("");
    api.listDatabases(connectionId).then(setDatabases).catch(() => setDatabases([]));
  }, [open, connectionId, database]);

  useEffect(() => {
    if (!open || !targetDatabase) return;
    api.listTables(connectionId, targetDatabase).then((list) => setTables(list.filter((x) => x.type !== "VIEW"))).catch(() => setTables([]));
  }, [open, connectionId, targetDatabase]);

  const compare = async () => {
    if (!targetTable) {
      toast.error(t("diff.targetRequired", "Choose a target table"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.dataDiff(connectionId, {
        sourceDatabase: database,
        sourceTable: table,
        targetDatabase,
        targetTable,
      });
      setResult(res);
    } catch (err) {
      toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!result?.sql) return;
    void navigator.clipboard.writeText(result.sql).then(() => toast.success(t("structure.copied", "Copied")));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-primary" /> {t("dataDiff.title", "Compare table data")}
          </DialogTitle>
          <DialogDescription>{database}.{table}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("dataDiff.targetDatabase", "Target database")}</Label>
            <Select value={targetDatabase} onValueChange={(v) => { setTargetDatabase(v); setTargetTable(""); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {databases.map((d) => <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("dataDiff.targetTable", "Target table")}</Label>
            <Select value={targetTable} onValueChange={setTargetTable}>
              <SelectTrigger className="h-8 font-mono text-xs"><SelectValue placeholder="table" /></SelectTrigger>
              <SelectContent>
                {tables.map((x) => <SelectItem key={x.name} value={x.name}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">source {result.sourceRows}</Badge>
              <Badge variant="outline">target {result.targetRows}</Badge>
              <Badge variant="success">insert {result.onlyInSource}</Badge>
              <Badge variant="warning">update {result.changed}</Badge>
              <Badge variant="destructive">delete {result.onlyInTarget}</Badge>
              {result.truncated && <Badge variant="warning">truncated</Badge>}
            </div>
            <div className="relative">
              <Textarea className="min-h-[300px] font-mono text-[11px]" value={result.sql || t("dataDiff.noDiff", "No differences found.")} readOnly spellCheck={false} />
              <Button size="icon-sm" variant="outline" className="absolute right-2 top-2" onClick={copy} disabled={!result.sql}>
                <Copy />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("dataDiff.hint", "Review the generated SQL before executing it. Rows are matched by the source primary key.")}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.close", "Close")}</Button>
          <Button onClick={() => void compare()} disabled={busy || !targetTable}>
            {busy ? <Loader2 className="animate-spin" /> : <GitCompare />} {t("dataDiff.compare", "Compare")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
