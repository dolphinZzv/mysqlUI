import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Table2, X } from "lucide-react";
import type { ColumnDefInput, CreateTableRequest } from "@/lib/types";
import { COLUMN_TYPES, defaultNewTableColumns, emptyColumn } from "@/lib/schema";
import { cn } from "@/lib/utils";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: CreateTableRequest) => Promise<void>;
}

interface IndexRow {
  name: string;
  unique: boolean;
  columns: string;
}

const TYPE_LIST_ID = "mysqlui-column-types";

function LabeledCheck({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  title: string;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-1 text-[10px] text-muted-foreground" title={title}>
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} className="h-3.5 w-3.5" />
      {label}
    </label>
  );
}

export function TableDesignerDialog({ open, onOpenChange, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [engine, setEngine] = useState("InnoDB");
  const [charset, setCharset] = useState("utf8mb4");
  const [collation, setCollation] = useState("");
  const [comment, setComment] = useState("");
  const [columns, setColumns] = useState<ColumnDefInput[]>(defaultNewTableColumns());
  const [indexes, setIndexes] = useState<IndexRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setEngine("InnoDB");
      setCharset("utf8mb4");
      setCollation("");
      setComment("");
      setColumns(defaultNewTableColumns());
      setIndexes([]);
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const updateColumn = (i: number, patch: Partial<ColumnDefInput>) =>
    setColumns((cols) => cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const submit = async () => {
    if (!name.trim()) {
      setError("Table name is required");
      return;
    }
    const valid = columns.filter((c) => c.name.trim());
    if (valid.length === 0) {
      setError("Add at least one column");
      return;
    }
    for (const c of valid) {
      if (!c.type.trim()) {
        setError(`Column "${c.name}" needs a type`);
        return;
      }
    }
    const request: CreateTableRequest = {
      name: name.trim(),
      engine,
      charset,
      collation: collation.trim(),
      comment: comment.trim(),
      columns: valid,
      indexes: indexes
        .filter((i) => i.columns.trim())
        .map((i) => ({
          name: i.name.trim(),
          unique: i.unique,
          columns: i.columns
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        })),
    };
    setSaving(true);
    setError(null);
    try {
      await onSubmit(request);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Table2 className="h-4 w-4 text-emerald-400" /> Create table
          </DialogTitle>
          <DialogDescription>Define columns and options, then run CREATE TABLE.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="t-name" className="text-xs">
              Table name
            </Label>
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 font-mono text-[13px]" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Engine</Label>
            <Select value={engine} onValueChange={setEngine}>
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["InnoDB", "MyISAM", "MEMORY", "ARCHIVE"].map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Charset</Label>
            <Select value={charset} onValueChange={setCharset}>
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["utf8mb4", "utf8", "latin1", "ascii"].map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-collation" className="text-xs">
              Collation (optional)
            </Label>
            <Input
              id="t-collation"
              value={collation}
              onChange={(e) => setCollation(e.target.value)}
              placeholder="utf8mb4_unicode_ci"
              className="h-8 font-mono text-[12px]"
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="t-comment" className="text-xs">
            Comment
          </Label>
          <Input id="t-comment" value={comment} onChange={(e) => setComment(e.target.value)} className="h-8 text-[13px]" />
        </div>

        <datalist id={TYPE_LIST_ID}>
          {COLUMN_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <div className="scrollbar-thin max-h-[42vh] overflow-auto rounded-lg border">
          <table className="w-max min-w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Length</th>
                <th className="px-2 py-2 font-medium" title="Nullable">Null</th>
                <th className="px-2 py-2 font-medium" title="Primary key">PK</th>
                <th className="px-2 py-2 font-medium" title="Auto increment">AI</th>
                <th className="px-2 py-2 font-medium" title="Unique">UQ</th>
                <th className="px-2 py-2 font-medium" title="Unsigned">Un</th>
                <th className="px-2 py-2 font-medium">Default</th>
                <th className="px-2 py-2 font-medium">Comment</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {columns.map((col, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">
                    <Input
                      className="h-7 w-[130px] font-mono text-[12px]"
                      value={col.name}
                      onChange={(e) => updateColumn(i, { name: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      list={TYPE_LIST_ID}
                      className="h-7 w-[110px] font-mono text-[12px]"
                      value={col.type}
                      onChange={(e) => updateColumn(i, { type: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      className="h-7 w-[70px] font-mono text-[12px]"
                      value={col.length}
                      onChange={(e) => updateColumn(i, { length: e.target.value })}
                    />
                  </td>
                  <td className="px-2 text-center">
                    <Checkbox checked={col.nullable} onCheckedChange={(v) => updateColumn(i, { nullable: Boolean(v) })} />
                  </td>
                  <td className="px-2 text-center">
                    <Checkbox checked={col.primaryKey} onCheckedChange={(v) => updateColumn(i, { primaryKey: Boolean(v) })} />
                  </td>
                  <td className="px-2 text-center">
                    <Checkbox checked={col.autoIncrement} onCheckedChange={(v) => updateColumn(i, { autoIncrement: Boolean(v) })} />
                  </td>
                  <td className="px-2 text-center">
                    <Checkbox checked={col.unique} onCheckedChange={(v) => updateColumn(i, { unique: Boolean(v) })} />
                  </td>
                  <td className="px-2 text-center">
                    <Checkbox checked={col.unsigned} onCheckedChange={(v) => updateColumn(i, { unsigned: Boolean(v) })} />
                  </td>
                  <td className="p-1">
                    <div className="flex items-center gap-1">
                      <LabeledCheck
                        checked={col.hasDefault}
                        onChange={(v) => updateColumn(i, { hasDefault: v })}
                        label="def"
                        title="Set a default value"
                      />
                      <Input
                        disabled={!col.hasDefault}
                        className="h-7 w-[110px] font-mono text-[12px]"
                        placeholder={col.hasDefault ? "NULL / value" : ""}
                        value={col.default === null || col.default === undefined ? "" : String(col.default)}
                        onChange={(e) => updateColumn(i, { default: e.target.value })}
                      />
                    </div>
                  </td>
                  <td className="p-1">
                    <Input
                      className="h-7 w-[120px] text-[12px]"
                      value={col.comment}
                      onChange={(e) => updateColumn(i, { comment: e.target.value })}
                    />
                  </td>
                  <td className="p-1 text-center">
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                      disabled={columns.length <= 1}
                      onClick={() => setColumns((cols) => cols.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setColumns((c) => [...c, emptyColumn()])}>
            <Plus /> Add column
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIndexes((idx) => [...idx, { name: "", unique: false, columns: "" }])}
          >
            <Plus /> Add index
          </Button>
        </div>

        {indexes.length > 0 && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground">Additional indexes</div>
            {indexes.map((idx, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="h-7 w-[150px] font-mono text-[12px]"
                  placeholder="index name"
                  value={idx.name}
                  onChange={(e) => setIndexes((all) => all.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
                />
                <Input
                  className="h-7 flex-1 font-mono text-[12px]"
                  placeholder="col1, col2"
                  value={idx.columns}
                  onChange={(e) => setIndexes((all) => all.map((x, k) => (k === i ? { ...x, columns: e.target.value } : x)))}
                />
                <LabeledCheck
                  checked={idx.unique}
                  onChange={(v) => setIndexes((all) => all.map((x, k) => (k === i ? { ...x, unique: v } : x)))}
                  label="unique"
                  title="Unique index"
                />
                <button
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setIndexes((all) => all.filter((_, k) => k !== i))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className={cn("gap-2")}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />} Create table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
