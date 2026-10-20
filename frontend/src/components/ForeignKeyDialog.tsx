import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { ColumnInfo, DatabaseInfo, TableInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  database: string;
  table: string;
  columns: ColumnInfo[];
  onCreated: () => void;
}

const ACTIONS = [
  { value: "", label: "Default" },
  { value: "CASCADE", label: "CASCADE" },
  { value: "SET NULL", label: "SET NULL" },
  { value: "RESTRICT", label: "RESTRICT" },
  { value: "NO ACTION", label: "NO ACTION" },
];

export function ForeignKeyDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  table,
  columns,
  onCreated,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [column, setColumn] = useState("");
  const [refDatabase, setRefDatabase] = useState(database);
  const [refTable, setRefTable] = useState("");
  const [refColumn, setRefColumn] = useState("");
  const [onDelete, setOnDelete] = useState("");
  const [onUpdate, setOnUpdate] = useState("");
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [refColumns, setRefColumns] = useState<ColumnInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setColumn(columns[0]?.name ?? "");
    setRefDatabase(database);
    setRefTable("");
    setRefColumn("");
    setOnDelete("");
    setOnUpdate("");
    setTables([]);
    setRefColumns([]);
    api.listDatabases(connectionId).then(setDatabases).catch(() => setDatabases([]));
  }, [open, connectionId, database, columns]);

  useEffect(() => {
    if (!open || !refDatabase) return;
    api
      .listTables(connectionId, refDatabase)
      .then((list) => setTables(list.filter((t) => t.type !== "VIEW")))
      .catch(() => setTables([]));
  }, [open, connectionId, refDatabase]);

  useEffect(() => {
    if (!open || !refDatabase || !refTable) {
      setRefColumns([]);
      return;
    }
    api
      .tableStructure(connectionId, refDatabase, refTable)
      .then((s) => setRefColumns(s.columns))
      .catch(() => setRefColumns([]));
  }, [open, connectionId, refDatabase, refTable]);

  const submit = async () => {
    if (!column || !refDatabase || !refTable || !refColumn) {
      toast.error(t("fk.required", "Column, referenced table and referenced column are required"));
      return;
    }
    setBusy(true);
    try {
      await api.addForeignKey(connectionId, database, table, {
        name: name.trim() || undefined,
        column,
        refDatabase,
        refTable,
        refColumn,
        onDelete: onDelete || undefined,
        onUpdate: onUpdate || undefined,
      });
      toast.success(t("fk.created", "Foreign key created"));
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> {t("fk.create", "Add foreign key")}
          </DialogTitle>
          <DialogDescription>
            {database}.{table}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("fk.name", "Constraint name (optional)")}</Label>
            <Input className="h-8 font-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="auto" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("fk.column", "Local column")}</Label>
              <Select value={column} onValueChange={setColumn}>
                <SelectTrigger className="h-8 font-mono text-xs">
                  <SelectValue placeholder="column" />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name} · {c.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("fk.refDatabase", "Referenced database")}</Label>
              <Select value={refDatabase} onValueChange={(v) => { setRefDatabase(v); setRefTable(""); setRefColumn(""); }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="database" />
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
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("fk.refTable", "Referenced table")}</Label>
              <Select value={refTable} onValueChange={(v) => { setRefTable(v); setRefColumn(""); }}>
                <SelectTrigger className="h-8 font-mono text-xs">
                  <SelectValue placeholder="table" />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("fk.refColumn", "Referenced column")}</Label>
              <Select value={refColumn} onValueChange={setRefColumn}>
                <SelectTrigger className="h-8 font-mono text-xs">
                  <SelectValue placeholder="column" />
                </SelectTrigger>
                <SelectContent>
                  {refColumns.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name} · {c.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("fk.onDelete", "ON DELETE")}</Label>
              <Select value={onDelete || "__default__"} onValueChange={(v) => setOnDelete(v === "__default__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a.value || "default"} value={a.value || "__default__"}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("fk.onUpdate", "ON UPDATE")}</Label>
              <Select value={onUpdate || "__default__"} onValueChange={(v) => setOnUpdate(v === "__default__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a.value || "default"} value={a.value || "__default__"}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("fk.hint", "The referenced column should be indexed (usually a primary key).")}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("common.add", "Add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
