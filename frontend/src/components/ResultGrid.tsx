import { useMemo, useRef, useState } from "react";
import { Check, Columns3, Copy, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CellValue } from "@/components/CellValue";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  columns: string[];
  rows: unknown[][];
  selected?: Set<number>;
  onSelectedChange?: (next: Set<number>) => void;
  hidden?: Set<string>;
  onHiddenChange?: (next: Set<string>) => void;
}

export function ResultGrid({ columns, rows, selected, onSelectedChange, hidden, onHiddenChange }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const timer = useRef<number | undefined>(undefined);

  const hiddenSet = hidden ?? new Set<string>();
  const selection = selected ?? new Set<number>();
  const selectable = Boolean(onSelectedChange);
  const visible = useMemo(
    () => columns.map((name, index) => ({ name, index })).filter((c) => !hiddenSet.has(c.name)),
    [columns, hiddenSet]
  );

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.map((row, index) => ({ row, index }));
    if (q) {
      out = out.filter(({ row }) => row.some((cell) => String(cell ?? "").toLowerCase().includes(q)));
    }
    if (sortCol !== null) {
      out = [...out].sort((a, b) => {
        const av = a.row[sortCol];
        const bv = b.row[sortCol];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const an = typeof av === "number" ? av : String(av);
        const bn = typeof bv === "number" ? bv : String(bv);
        return (an < bn ? -1 : 1) * sortDir;
      });
    }
    return out;
  }, [rows, query, sortCol, sortDir]);

  const copyCell = (value: unknown, key: string) => {
    const text = value === null || value === undefined ? "NULL" : String(value);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1200);
    });
  };

  const setSelection = (next: Set<number>) => onSelectedChange?.(next);
  const allSelected = rows.length > 0 && selection.size >= rows.length;
  const someSelected = selection.size > 0 && !allSelected;
  const toggleAll = () => {
    if (allSelected || someSelected) setSelection(new Set());
    else setSelection(new Set(rows.map((_, i) => i)));
  };
  const toggleRow = (index: number, checked: boolean) => {
    const next = new Set(selection);
    if (checked) next.add(index);
    else next.delete(index);
    setSelection(next);
  };

  const setColumnVisible = (name: string, show: boolean) => {
    if (!onHiddenChange) return;
    const next = new Set(hiddenSet);
    if (show) next.delete(name);
    else next.add(name);
    onHiddenChange(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 w-[240px] pl-7 text-xs"
            placeholder="Filter results"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {onHiddenChange && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs">
                <Columns3 /> Columns ({visible.length}/{columns.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
              <DropdownMenuLabel>Show result columns</DropdownMenuLabel>
              {columns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={!hiddenSet.has(column)}
                  onCheckedChange={(checked) => setColumnVisible(column, checked)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {column}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onHiddenChange(new Set())}>Show all columns</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {selectable && selection.size > 0 && (
          <span className="text-xs text-muted-foreground">
            {selection.size} row(s) selected
            <Button size="sm" variant="ghost" className="ml-1 h-6 px-2 text-xs" onClick={() => setSelection(new Set())}>
              Clear
            </Button>
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {displayed.length} of {rows.length} row(s)
        </span>
      </div>
      <div className="scrollbar-thin relative min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-20">
            <tr>
              {selectable && (
                <th className="sticky left-0 z-30 w-8 border-b border-r bg-card px-2 py-1.5">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all result rows"
                  />
                </th>
              )}
              <th
                className={cn(
                  "sticky z-30 w-10 border-b border-r bg-card px-2 py-1.5 text-right text-[11px] font-medium text-muted-foreground",
                  selectable ? "left-8" : "left-0"
                )}
              >
                #
              </th>
              {visible.map((col) => (
                <th
                  key={col.name}
                  onClick={() => {
                    if (sortCol === col.index) setSortDir((d) => (d === 1 ? -1 : 1));
                    else {
                      setSortCol(col.index);
                      setSortDir(1);
                    }
                  }}
                  className="cursor-pointer border-b border-r bg-card px-3 py-1.5 text-left font-medium hover:bg-muted/40"
                >
                  <span className="block max-w-[360px] truncate">
                    {col.name}
                    {sortCol === col.index ? (sortDir === 1 ? " ↑" : " ↓") : ""}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map(({ row, index: r }) => {
              const isSelected = selection.has(r);
              return (
                <tr key={r} className={cn("group hover:bg-muted/40", isSelected && "bg-primary/10")}>
                  {selectable && (
                    <td className="sticky left-0 z-10 border-b border-r bg-card px-2 py-1 text-center group-hover:bg-muted">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(v) => toggleRow(r, Boolean(v))}
                        aria-label={`Select result row ${r + 1}`}
                      />
                    </td>
                  )}
                  <td
                    className={cn(
                      "sticky z-10 border-b border-r bg-card px-2 py-1 text-right text-[11px] text-muted-foreground group-hover:bg-muted",
                      selectable ? "left-8" : "left-0"
                    )}
                  >
                    {r + 1}
                  </td>
                  {visible.map((col) => {
                    const cell = row[col.index];
                    const numeric = typeof cell === "number";
                    const key = `${r}:${col.index}`;
                    return (
                      <td
                        key={col.index}
                        className={cn(
                          "group/cell relative max-w-[420px] cursor-pointer border-b border-r px-3 py-1 align-top",
                          numeric && "text-right tabular-nums"
                        )}
                        onDoubleClick={() => copyCell(cell, key)}
                      >
                        <div className="flex items-center gap-1.5">
                          <CellValue value={cell} />
                          <button
                            className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover/cell:opacity-100"
                            title="Copy value"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyCell(cell, key);
                            }}
                          >
                            {copied === key ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {displayed.length === 0 && (
              <tr>
                <td
                  colSpan={visible.length + (selectable ? 2 : 1)}
                  className="px-3 py-10 text-center text-sm text-muted-foreground"
                >
                  No rows returned.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
