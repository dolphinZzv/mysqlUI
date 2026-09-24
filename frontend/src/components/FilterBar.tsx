import { useEffect, useState } from "react";
import { Filter, Plus, X } from "lucide-react";
import type { FilterCondition } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  columns: string[];
  filters: FilterCondition[];
  onApply: (filters: FilterCondition[]) => void;
}

const OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
  { value: "=", label: "=" },
  { value: "!=", label: "≠" },
  { value: ">", label: ">" },
  { value: ">=", label: "≥" },
  { value: "<", label: "<" },
  { value: "<=", label: "≤" },
  { value: "contains", label: "contains" },
  { value: "starts with", label: "starts with" },
  { value: "ends with", label: "ends with" },
  { value: "in", label: "in (a,b,c)" },
  { value: "is null", label: "is null", noValue: true },
  { value: "is not null", label: "is not null", noValue: true },
];

function opLabel(op: string): string {
  return OPERATORS.find((o) => o.value === op)?.label ?? op;
}

export function FilterBar({ columns, filters, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterCondition[]>(filters);

  useEffect(() => {
    if (open) setDraft(filters.length ? filters : []);
  }, [open, filters]);

  const addCondition = () => {
    setDraft((d) => [...d, { column: columns[0] ?? "", op: "=", value: "" }]);
  };

  const update = (i: number, patch: Partial<FilterCondition>) => {
    setDraft((d) => d.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const remove = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));

  const apply = () => {
    const cleaned = draft
      .filter((c) => c.column)
      .map((c) => {
        const op = c.op;
        if (op === "is null" || op === "is not null") return { column: c.column, op };
        if (op === "in") {
          const parts = String(c.value ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return { column: c.column, op, value: parts };
        }
        return { column: c.column, op, value: c.value };
      });
    onApply(cleaned);
    setOpen(false);
  };

  const clear = () => {
    setDraft([]);
    onApply([]);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant={filters.length ? "default" : "outline"}>
            <Filter /> Filter
            {filters.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {filters.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[520px]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">Filter rows</span>
            <Button size="sm" variant="ghost" onClick={clear} disabled={!filters.length && !draft.length}>
              Clear all
            </Button>
          </div>

          <div className="scrollbar-thin max-h-[45vh] space-y-2 overflow-y-auto pr-1">
            {draft.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">No conditions yet</p>
            )}
            {draft.map((cond, i) => {
              const opDef = OPERATORS.find((o) => o.value === cond.op);
              return (
                <div key={i} className="flex items-center gap-2">
                  <Select value={cond.column} onValueChange={(v) => update(i, { column: v })}>
                    <SelectTrigger className="h-8 w-[150px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={cond.op} onValueChange={(v) => update(i, { op: v })}>
                    <SelectTrigger className="h-8 w-[130px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {opDef?.noValue ? (
                    <div className="h-8 flex-1" />
                  ) : (
                    <Input
                      className={cn("h-8 flex-1 text-xs")}
                      placeholder="value"
                      value={String(cond.value ?? "")}
                      onChange={(e) => update(i, { value: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && apply()}
                    />
                  )}

                  <Button size="icon-sm" variant="ghost" onClick={() => remove(i)}>
                    <X />
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={addCondition} disabled={columns.length === 0}>
              <Plus /> Add condition
            </Button>
            <Button size="sm" onClick={apply}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {filters.map((f, i) => (
            <Badge key={i} variant="secondary" className="gap-1 font-mono text-[10px] font-normal">
              {f.column} {opLabel(f.op)} {f.op === "in" ? (Array.isArray(f.value) ? f.value.join(",") : "") : f.op.includes("null") ? "" : String(f.value ?? "")}
              <button
                className="rounded-full hover:text-destructive"
                onClick={() => onApply(filters.filter((_, idx) => idx !== i))}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
