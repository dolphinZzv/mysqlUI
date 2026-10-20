import { useEffect, useMemo, useState } from "react";
import { Play, Save, Trash2, Variable } from "lucide-react";
import type { ParamValue } from "@/lib/sqlParams";
import { applyParams, deleteParamSet, loadParamSets, saveParamSet } from "@/lib/sqlParams";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sql: string;
  names: string[];
  connectionName?: string;
  database?: string;
  onRun: (sql: string) => void;
}

export function ParameterDialog({ open, onOpenChange, sql, names, connectionName, database, onRun }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [nulls, setNulls] = useState<Record<string, boolean>>({});
  const [sets, setSets] = useState(loadParamSets);
  const [setId, setSetId] = useState("");
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    if (!open) return;
    setValues((prev) => {
      const next: Record<string, string> = {};
      for (const name of names) next[name] = prev[name] ?? "";
      return next;
    });
    setSets(loadParamSets());
  }, [open, names]);

  const resolved = useMemo(() => {
    const out: Record<string, ParamValue> = {};
    for (const name of names) {
      const raw = values[name] ?? "";
      if (nulls[name]) out[name] = null;
      else if (raw !== "" && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(raw.trim())) out[name] = Number(raw);
      else out[name] = raw;
    }
    return out;
  }, [names, values, nulls]);

  const preview = useMemo(() => applyParams(sql, resolved), [sql, resolved]);

  const applySet = (id: string) => {
    setSetId(id);
    const set = sets.find((s) => s.id === id);
    if (!set) return;
    const nextValues: Record<string, string> = {};
    const nextNulls: Record<string, boolean> = {};
    for (const name of names) {
      const value = set.values[name];
      nextNulls[name] = value === null;
      nextValues[name] = value === null || value === undefined ? "" : String(value);
    }
    setValues(nextValues);
    setNulls(nextNulls);
  };

  const submit = () => {
    if (saveName.trim()) {
      saveParamSet({
        name: saveName.trim(),
        connectionName,
        database,
        sql,
        values: resolved,
      });
      setSaveName("");
      setSets(loadParamSets());
    }
    onRun(preview);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Variable className="h-4 w-4 text-primary" /> Query parameters
          </DialogTitle>
          <DialogDescription>
            Values are safely quoted as MySQL literals before execution. Use the NULL checkbox for SQL NULL.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            {names.map((name) => (
              <div key={name} className="grid gap-1">
                <div className="flex items-center justify-between">
                  <Label className="font-mono text-xs">{name}</Label>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Checkbox
                      checked={Boolean(nulls[name])}
                      onCheckedChange={(checked) => setNulls((prev) => ({ ...prev, [name]: Boolean(checked) }))}
                    />
                    NULL
                  </label>
                </div>
                <Input
                  className="h-8 font-mono text-xs"
                  value={values[name] ?? ""}
                  disabled={Boolean(nulls[name])}
                  onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
                />
              </div>
            ))}
            <div className="grid gap-1 border-t pt-2">
              <Label className="text-xs">Load parameter set</Label>
              <div className="flex gap-1.5">
                <Select value={setId} onValueChange={applySet}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Saved sets" />
                  </SelectTrigger>
                  <SelectContent>
                    {sets.map((set) => (
                      <SelectItem key={set.id} value={set.id}>
                        {set.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="hover:text-destructive"
                  disabled={!setId}
                  title="Delete saved set"
                  onClick={() => {
                    deleteParamSet(setId);
                    setSets(loadParamSets());
                    setSetId("");
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="flex gap-1.5">
                <Input
                  className="h-8 text-xs"
                  placeholder="Save values as…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <Button size="icon-sm" variant="outline" disabled={!saveName.trim()} title="Save parameter set">
                  <Save />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            <Label className="mb-1 text-xs">Preview</Label>
            <pre className="scrollbar-thin max-h-80 min-h-40 flex-1 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
              {preview}
            </pre>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>
            <Play /> Run query
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
