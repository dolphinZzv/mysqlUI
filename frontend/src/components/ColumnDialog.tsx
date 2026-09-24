import { useEffect, useState } from "react";
import { Check, Columns3, Loader2 } from "lucide-react";
import type { ColumnDefInput } from "@/lib/types";
import { COLUMN_TYPES, emptyColumn } from "@/lib/schema";
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

const TYPE_LIST_ID = "mysqlui-col-types-single";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "modify";
  column: ColumnDefInput;
  existingNames: string[];
  onSubmit: (column: ColumnDefInput, after?: string) => Promise<void>;
}

function CheckField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer select-none items-center gap-1.5 text-xs">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} />
      {label}
    </label>
  );
}

export function ColumnDialog({ open, onOpenChange, mode, column, existingNames, onSubmit }: Props) {
  const [form, setForm] = useState<ColumnDefInput>(column);
  const [after, setAfter] = useState<string>("__end__");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(mode === "add" ? emptyColumn({ type: "varchar", length: "255" }) : column);
      setAfter("__end__");
      setError(null);
      setSaving(false);
    }
  }, [open, column, mode]);

  const set = <K extends keyof ColumnDefInput>(key: K, value: ColumnDefInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      setError("Column name is required");
      return;
    }
    if (!form.type.trim()) {
      setError("Type is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form, mode === "add" && after !== "__end__" ? after : undefined);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Columns3 className="h-4 w-4 text-primary" />
            {mode === "add" ? "Add column" : `Edit column "${column.name}"`}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "Adds a column with ALTER TABLE ... ADD COLUMN."
              : "Applies ALTER TABLE ... CHANGE COLUMN (rename and/or retype)."}
          </DialogDescription>
        </DialogHeader>

        <datalist id={TYPE_LIST_ID}>
          {COLUMN_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Name</Label>
            <Input className="h-8 font-mono text-[13px]" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Type</Label>
            <Input
              list={TYPE_LIST_ID}
              className="h-8 font-mono text-[13px]"
              value={form.type}
              onChange={(e) => set("type", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Length / values</Label>
            <Input
              className="h-8 font-mono text-[13px]"
              placeholder="255 or 10,2 or 'a','b'"
              value={form.length}
              onChange={(e) => set("length", e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Default</Label>
            <div className="flex items-center gap-2">
              <CheckField
                id="col-hasdef"
                label="set"
                checked={form.hasDefault}
                onChange={(v) => set("hasDefault", v)}
              />
              <Input
                disabled={!form.hasDefault}
                className="h-8 flex-1 font-mono text-[13px]"
                placeholder={form.hasDefault ? "NULL / CURRENT_TIMESTAMP" : ""}
                value={form.default === null || form.default === undefined ? "" : String(form.default)}
                onChange={(e) => set("default", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <CheckField id="col-null" label="Nullable" checked={form.nullable} onChange={(v) => set("nullable", v)} />
          <CheckField id="col-ai" label="Auto increment" checked={form.autoIncrement} onChange={(v) => set("autoIncrement", v)} />
          <CheckField id="col-un" label="Unsigned" checked={form.unsigned} onChange={(v) => set("unsigned", v)} />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">Comment</Label>
          <Input className="h-8 text-[13px]" value={form.comment} onChange={(e) => set("comment", e.target.value)} />
        </div>

        {mode === "add" && existingNames.length > 0 && (
          <div className="grid gap-1.5">
            <Label className="text-xs">Position</Label>
            <Select value={after} onValueChange={setAfter}>
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__end__">At the end</SelectItem>
                {existingNames.map((n) => (
                  <SelectItem key={n} value={n}>
                    After {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            {mode === "add" ? "Add column" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
