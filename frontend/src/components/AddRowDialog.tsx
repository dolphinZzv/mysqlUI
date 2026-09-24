import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { ColumnInfo } from "@/lib/types";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: ColumnInfo[];
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}

const isAuto = (c: ColumnInfo) => {
  const extra = c.extra.toLowerCase();
  return extra.includes("auto_increment") || extra.includes("default_generated");
};

const hasDefault = (c: ColumnInfo) => c.default !== null && c.default !== undefined;

const isLong = (c: ColumnInfo) => /text|blob|json/i.test(c.type);

const isNumber = (c: ColumnInfo) => /^(tiny|small|medium|big)?int|decimal|float|double|numeric|year/i.test(c.type);

export function AddRowDialog({ open, onOpenChange, columns, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [nulls, setNulls] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues({});
      setNulls(new Set());
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const entries = useMemo(() => columns, [columns]);

  const submit = async () => {
    const data: Record<string, unknown> = {};
    for (const col of entries) {
      if (nulls.has(col.name)) {
        data[col.name] = null;
        continue;
      }
      const raw = values[col.name] ?? "";
      if (raw === "") {
        if (isAuto(col) || col.nullable || hasDefault(col)) continue;
        setError(`"${col.name}" is required`);
        return;
      }
      data[col.name] = raw;
    }
    if (Object.keys(data).length === 0) {
      setError("Provide at least one value");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" /> Insert row
          </DialogTitle>
          <DialogDescription>
            Fill in the values for the new row. Leave a field empty to use its default (or NULL).
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid gap-3">
            {entries.map((col) => {
              const disabled = nulls.has(col.name);
              return (
                <div key={col.name} className="grid gap-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`f-${col.name}`} className="font-mono text-[13px]">
                      {col.name}
                    </Label>
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                      {col.type}
                    </Badge>
                    {col.key === "PRI" && (
                      <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                        PK
                      </Badge>
                    )}
                    {isAuto(col) && (
                      <span className="text-[10px] text-muted-foreground">auto</span>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      <Checkbox
                        id={`n-${col.name}`}
                        checked={disabled}
                        onCheckedChange={(checked) => {
                          setNulls((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(col.name);
                            else next.delete(col.name);
                            return next;
                          });
                        }}
                      />
                      <Label
                        htmlFor={`n-${col.name}`}
                        className={cn(
                          "cursor-pointer text-[11px]",
                          !col.nullable && "opacity-40"
                        )}
                        title={col.nullable ? "Set NULL" : "Column is NOT NULL"}
                      >
                        NULL
                      </Label>
                    </div>
                  </div>
                  {isLong(col) ? (
                    <Textarea
                      id={`f-${col.name}`}
                      disabled={disabled}
                      rows={2}
                      value={values[col.name] ?? ""}
                      placeholder={isAuto(col) ? "(auto)" : hasDefault(col) ? `default: ${String(col.default)}` : ""}
                      onChange={(e) => setValues((v) => ({ ...v, [col.name]: e.target.value }))}
                      className="font-mono text-[13px]"
                    />
                  ) : (
                    <Input
                      id={`f-${col.name}`}
                      disabled={disabled}
                      type={isNumber(col) ? "number" : "text"}
                      value={values[col.name] ?? ""}
                      placeholder={isAuto(col) ? "(auto)" : hasDefault(col) ? `default: ${String(col.default)}` : ""}
                      onChange={(e) => setValues((v) => ({ ...v, [col.name]: e.target.value }))}
                      className="font-mono text-[13px]"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

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
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
