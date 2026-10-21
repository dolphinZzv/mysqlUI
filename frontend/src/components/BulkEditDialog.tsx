import { useMemo, useState } from "react";
import { Replace, Wand2 } from "lucide-react";
import type { ColumnInfo } from "@/lib/types";
import type { PasteCellChange } from "@/components/PasteCellsDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: string[];
  columnsMeta: ColumnInfo[];
  rows: unknown[][];
  selected: Set<number>;
  onApply: (changes: PasteCellChange[]) => void;
}

export function BulkEditDialog({ open, onOpenChange, columns, columnsMeta, rows, selected, onApply }: Props) {
  const [mode, setMode] = useState<"set" | "replace">("set");
  const [column, setColumn] = useState(columns[0] ?? "");
  const [value, setValue] = useState("");
  const [isNull, setIsNull] = useState(false);
  const [search, setSearch] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scope, setScope] = useState<"selected" | "page">("selected");
  const [replaceColumn, setReplaceColumn] = useState("__all__");

  const metaByName = useMemo(() => new Map(columnsMeta.map((meta) => [meta.name, meta])), [columnsMeta]);
  const targetRows = useMemo(
    () => (scope === "selected" && selected.size > 0 ? [...selected] : rows.map((_, index) => index)),
    [scope, selected, rows]
  );
  const changes = useMemo<PasteCellChange[]>(() => {
    if (mode === "set") {
      if (!column) return [];
      return targetRows.map((rowIndex) => ({ rowIndex, column, value: isNull ? null : value }));
    }
    const needle = search;
    if (!needle) return [];
    const out: PasteCellChange[] = [];
    const columnsToEdit = replaceColumn === "__all__" ? columns : [replaceColumn];
    const haystack = (text: string) => (caseSensitive ? text : text.toLowerCase());
    const pattern = haystack(needle);
    for (const rowIndex of targetRows) {
      for (const name of columnsToEdit) {
        const index = columns.indexOf(name);
        const current = rows[rowIndex]?.[index];
        if (current === null || current === undefined) continue;
        const text = String(current);
        if (!haystack(text).includes(pattern)) continue;
        const next = caseSensitive
          ? text.split(needle).join(replacement)
          : text.replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replacement);
        if (next !== text) out.push({ rowIndex, column: name, value: next });
      }
    }
    return out;
  }, [mode, column, value, isNull, targetRows, search, replacement, caseSensitive, replaceColumn, columns, rows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" /> Bulk edit rows
          </DialogTitle>
          <DialogDescription>
            Changes join the pending batch; nothing is written until you commit the batch.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(next) => setMode(next as "set" | "replace")}>
          <TabsList className="h-8">
            <TabsTrigger value="set" className="text-xs">Set column value</TabsTrigger>
            <TabsTrigger value="replace" className="text-xs">Find & replace</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Apply to
            <Select value={scope} onValueChange={(next) => setScope(next as "selected" | "page")}>
              <SelectTrigger className="h-7 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selected">Selected rows ({selected.size})</SelectItem>
                <SelectItem value="page">All rows on page ({rows.length})</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "set" ? (
            <>
              <div className="grid gap-1.5">
                <Label className="text-xs">Column</Label>
                <Select value={column} onValueChange={setColumn}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">New value</Label>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Checkbox checked={isNull} onCheckedChange={(checked) => setIsNull(Boolean(checked))} />
                    NULL
                  </label>
                </div>
                <Input
                  className="h-8 font-mono text-xs"
                  value={value}
                  disabled={isNull}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Find</Label>
                  <Input className="h-8 font-mono text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Replace with</Label>
                  <Input className="h-8 font-mono text-xs" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Column</Label>
                <Select value={replaceColumn} onValueChange={setReplaceColumn}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All columns</SelectItem>
                    {columns.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={caseSensitive} onCheckedChange={(checked) => setCaseSensitive(Boolean(checked))} />
                Case sensitive
              </label>
            </>
          )}
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {changes.length} cell change(s) will be added to the pending batch.
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={changes.length === 0}
            onClick={() => {
              onApply(changes);
              onOpenChange(false);
            }}
          >
            {mode === "set" ? <Wand2 /> : <Replace />} Add changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
