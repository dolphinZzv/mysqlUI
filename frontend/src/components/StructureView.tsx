import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Database,
  Key,
  Layers,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { ColumnDefInput, ColumnInfo, IndexDefInput, TableStructure } from "@/lib/types";
import { splitType } from "@/lib/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CellValue } from "@/components/CellValue";
import { ColumnDialog } from "@/components/ColumnDialog";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  structure: TableStructure;
  connectionId: string;
  database: string;
  table: string;
  onRefresh: () => void;
  onRenamed: (newName: string) => void;
  onDropped: () => void;
}

type Pending =
  | { kind: "column"; name: string }
  | { kind: "index"; name: string }
  | { kind: "table" }
  | null;

function toColumnDef(col: ColumnInfo): ColumnDefInput {
  const { base, length } = splitType(col.type);
  return {
    name: col.name,
    type: base || col.type,
    length,
    nullable: col.nullable,
    autoIncrement: /auto_increment/i.test(col.extra),
    primaryKey: col.key === "PRI",
    unique: col.key === "UNI",
    default: col.default === undefined ? null : col.default,
    hasDefault: col.default !== undefined,
    comment: col.comment,
    unsigned: /unsigned/i.test(col.type),
  };
}

export function StructureView({
  structure,
  connectionId,
  database,
  table,
  onRefresh,
  onRenamed,
  onDropped,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [columnDialog, setColumnDialog] = useState<{ open: boolean; mode: "add" | "modify"; column: ColumnDefInput }>({
    open: false,
    mode: "add",
    column: toColumnDef({ name: "", type: "varchar(255)", collation: null, nullable: true, key: "", default: undefined, extra: "", comment: "" }),
  });
  const [indexDialog, setIndexDialog] = useState<IndexDefInput & { columnsText: string }>({
    name: "",
    unique: false,
    columns: [],
    columnsText: "",
  });
  const [indexOpen, setIndexOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState(table);

  const indexes = useMemo(() => {
    const map = new Map<string, { name: string; unique: boolean; type: string; columns: string[]; cardinality: number | null }>();
    for (const idx of structure.indexes) {
      const existing = map.get(idx.name);
      if (existing) {
        existing.columns[idx.seq - 1] = idx.column;
        if (idx.cardinality !== null) existing.cardinality = idx.cardinality;
      } else {
        const columns: string[] = [];
        columns[idx.seq - 1] = idx.column;
        map.set(idx.name, {
          name: idx.name,
          unique: idx.unique,
          type: idx.indexType,
          columns,
          cardinality: idx.cardinality,
        });
      }
    }
    return Array.from(map.values());
  }, [structure.indexes]);

  const copyCreate = () => {
    void navigator.clipboard.writeText(structure.createSql).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      onRefresh();
    } catch (err) {
      toast.error("Operation failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    if (pending.kind === "column") {
      await run(() => api.dropColumn(connectionId, database, table, pending.name), `Dropped column "${pending.name}"`);
    } else if (pending.kind === "index") {
      await run(() => api.dropIndex(connectionId, database, table, pending.name), `Dropped index "${pending.name}"`);
    } else if (pending.kind === "table") {
      setBusy(true);
      try {
        await api.dropTable(connectionId, database, table);
        toast.success(`Dropped table "${table}"`);
        onDropped();
      } catch (err) {
        toast.error("Failed to drop table", { description: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
        setPending(null);
      }
    }
  };

  const submitColumn = async (column: ColumnDefInput, after?: string) => {
    if (columnDialog.mode === "add") {
      await api.addColumn(connectionId, database, table, column, after);
      toast.success(`Added column "${column.name}"`);
    } else {
      await api.modifyColumn(connectionId, database, table, columnDialog.column.name, column);
      toast.success(`Updated column "${column.name}"`);
    }
    onRefresh();
  };

  const submitIndex = async () => {
    const columns = indexDialog.columnsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!indexDialog.name.trim()) {
      toast.error("Index name is required");
      return;
    }
    if (columns.length === 0) {
      toast.error("Provide at least one column");
      return;
    }
    setBusy(true);
    try {
      await api.addIndex(connectionId, database, table, {
        name: indexDialog.name.trim(),
        unique: indexDialog.unique,
        columns,
      });
      toast.success("Index created");
      setIndexOpen(false);
      onRefresh();
    } catch (err) {
      toast.error("Failed to create index", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    if (!newName.trim() || newName === table) {
      setRenameOpen(false);
      return;
    }
    setBusy(true);
    try {
      await api.renameTable(connectionId, database, table, newName.trim());
      toast.success(`Renamed to "${newName.trim()}"`);
      setRenameOpen(false);
      onRenamed(newName.trim());
    } catch (err) {
      toast.error("Rename failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const existingNames = structure.columns.map((c) => c.name);

  return (
    <div className="scrollbar-thin h-full overflow-auto p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Table2 className="h-4 w-4 text-emerald-400" />
        <span className="font-semibold">{structure.name}</span>
        <Badge variant={structure.type === "VIEW" ? "warning" : "secondary"}>{structure.type || "TABLE"}</Badge>
        {structure.engine && (
          <Badge variant="outline">
            <Database className="mr-1 h-3 w-3" />
            {structure.engine}
          </Badge>
        )}
        {structure.comment && <span className="text-muted-foreground">— {structure.comment}</span>}
        <span className="text-muted-foreground">
          {structure.columns.length} columns · {indexes.length} indexes
        </span>

        <div className="ml-auto flex items-center gap-2">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Button size="sm" variant="outline" onClick={() => setColumnDialog({ open: true, mode: "add", column: columnDialog.column })}>
            <Plus /> Column
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setIndexDialog({ name: "", unique: false, columns: [], columnsText: "" }); setIndexOpen(true); }}>
            <Plus /> Index
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setNewName(table); setRenameOpen(true); }}>
            <Pencil /> Rename
          </Button>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setPending({ kind: "table" })}>
            <Trash2 /> Drop
          </Button>
        </div>
      </div>

      <section className="mb-6">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-muted-foreground" /> Columns
        </h3>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Nullable</th>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Default</th>
                <th className="px-3 py-2 font-medium">Extra</th>
                <th className="px-3 py-2 font-medium">Comment</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {structure.columns.map((col) => (
                <tr key={col.name} className="group border-t">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                    <span className="flex items-center gap-1.5">
                      {col.key === "PRI" && <Key className="h-3 w-3 text-amber-500" />}
                      {col.name}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-sky-400">{col.type}</td>
                  <td className="px-3 py-1.5">
                    {col.nullable ? <span className="text-muted-foreground">YES</span> : <span className="text-amber-500">NO</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {col.key && (
                      <Badge
                        variant={col.key === "PRI" ? "warning" : col.key === "UNI" ? "success" : "secondary"}
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {col.key}
                      </Badge>
                    )}
                  </td>
                  <td className="max-w-[220px] px-3 py-1.5 font-mono text-muted-foreground">
                    <CellValue value={col.default} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{col.extra}</td>
                  <td className="max-w-[280px] px-3 py-1.5 text-muted-foreground">
                    <CellValue value={col.comment || null} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Edit column"
                        onClick={() => setColumnDialog({ open: true, mode: "modify", column: toColumnDef(col) })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Drop column"
                        className="hover:text-destructive"
                        onClick={() => setPending({ kind: "column", name: col.name })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ListTree className="h-4 w-4 text-muted-foreground" /> Indexes
        </h3>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Unique</th>
                <th className="px-3 py-2 font-medium">Columns</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Cardinality</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => (
                <tr key={idx.name} className="group border-t">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono">{idx.name}</td>
                  <td className="px-3 py-1.5">
                    {idx.unique ? (
                      <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                        UNIQUE
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">no</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono">{idx.columns.filter(Boolean).join(", ")}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{idx.type}</td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{idx.cardinality ?? "-"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={idx.name === "PRIMARY" ? "Primary key" : "Drop index"}
                        className="hover:text-destructive"
                        disabled={idx.name === "PRIMARY"}
                        onClick={() => setPending({ kind: "index", name: idx.name })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {indexes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No indexes
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Database className="h-4 w-4 text-muted-foreground" /> CREATE statement
          </h3>
          <Button size="sm" variant="outline" onClick={copyCreate} disabled={!structure.createSql}>
            {copied ? <Check className="text-emerald-500" /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="scrollbar-thin overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-[12px] leading-relaxed">
          {structure.createSql || "-- not available"}
        </pre>
      </section>

      <ColumnDialog
        open={columnDialog.open}
        onOpenChange={(o) => setColumnDialog((s) => ({ ...s, open: o }))}
        mode={columnDialog.mode}
        column={columnDialog.column}
        existingNames={existingNames}
        onSubmit={submitColumn}
      />

      <Dialog open={indexOpen} onOpenChange={setIndexOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create index</DialogTitle>
            <DialogDescription>Adds an index with ALTER TABLE ... ADD INDEX.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                className="h-8 font-mono text-[13px]"
                value={indexDialog.name}
                onChange={(e) => setIndexDialog((s) => ({ ...s, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Columns (comma separated)</Label>
              <Input
                className="h-8 font-mono text-[13px]"
                placeholder="col1, col2"
                value={indexDialog.columnsText}
                onChange={(e) => setIndexDialog((s) => ({ ...s, columnsText: e.target.value }))}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={indexDialog.unique}
                onCheckedChange={(v) => setIndexDialog((s) => ({ ...s, unique: Boolean(v) }))}
              />
              Unique index
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIndexOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitIndex} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename table</DialogTitle>
            <DialogDescription>Renames "{table}".</DialogDescription>
          </DialogHeader>
          <Input
            className="h-8 font-mono text-[13px]"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitRename} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              {pending?.kind === "table"
                ? `Drop table "${table}"?`
                : pending?.kind === "column"
                  ? `Drop column "${pending.name}"?`
                  : pending?.kind === "index"
                    ? `Drop index "${pending.name}"?`
                    : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "table"
                ? "This permanently deletes the table and all of its data."
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={confirmPending}
            >
              {busy ? <Loader2 className="animate-spin" /> : "Drop"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
