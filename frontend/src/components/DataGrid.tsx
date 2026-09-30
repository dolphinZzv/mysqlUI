import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Copy,
  Eye,
  Key,
  Link2,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ColumnInfo, ForeignKeyInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CellValue } from "@/components/CellValue";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface Props {
  columns: string[];
  rows: unknown[][];
  columnsMeta: ColumnInfo[];
  primaryKey: string[];
  foreignKeys?: ForeignKeyInfo[];
  orderBy?: string;
  onSort?: (column: string) => void;
  onUpdateCell: (rowIndex: number, column: string, value: unknown) => Promise<void>;
  onDeleteRow: (rowIndex: number) => void;
  onViewCell?: (rowIndex: number, column: string) => void;
  onJump?: (foreignKey: ForeignKeyInfo, value: unknown) => void;
  /** Row indices (page-local) that are currently selected. */
  selected?: Set<number>;
  onSelectedChange?: (next: Set<number>) => void;
}

interface Editing {
  r: number;
  c: number;
}

export function DataGrid({
  columns,
  rows,
  columnsMeta,
  primaryKey,
  foreignKeys = [],
  orderBy,
  onSort,
  onUpdateCell,
  onDeleteRow,
  onViewCell,
  onJump,
  selected,
  onSelectedChange,
}: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const selection = selected ?? new Set<number>();
  const selectable = Boolean(onSelectedChange);

  // Drag / box selection: dragging across rows selects the range between the
  // anchor and the row under the cursor. Shift extends from the anchor and
  // Cmd/Ctrl adds to the current selection.
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragAnchorRef = useRef<number | null>(null);
  const dragBaseRef = useRef<Set<number>>(new Set());
  const dragMovedRef = useRef(false);
  const dragHoverRef = useRef<number | null>(null);

  const metaByName = useMemo(() => {
    const m = new Map<string, ColumnInfo>();
    columnsMeta.forEach((c) => m.set(c.name, c));
    return m;
  }, [columnsMeta]);

  const fkByName = useMemo(() => {
    const m = new Map<string, ForeignKeyInfo>();
    foreignKeys.forEach((fk) => m.set(fk.column, fk));
    return m;
  }, [foreignKeys]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  const setSelection = (next: Set<number>) => onSelectedChange?.(next);

  const indicesInRange = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const out: number[] = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
  };

  const toggleRow = (index: number, checked: boolean) => {
    const next = new Set(selection);
    if (checked) next.add(index);
    else next.delete(index);
    setSelection(next);
  };

  const allSelected = rows.length > 0 && selection.size >= rows.length;
  const someSelected = selection.size > 0 && !allSelected;
  const toggleAll = () => {
    if (allSelected || someSelected) setSelection(new Set());
    else setSelection(new Set(rows.map((_, i) => i)));
  };

  const onRowMouseDown = (index: number, event: ReactMouseEvent) => {
    if (!selectable || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, [role="checkbox"], [data-slot="checkbox"], [role="menuitem"]')) {
      return;
    }
    // Do not hijack an intentional text selection.
    if (window.getSelection()?.toString()) return;

    event.preventDefault();
    dragMovedRef.current = false;
    dragHoverRef.current = index;

    if (event.shiftKey && dragAnchorRef.current !== null) {
      setSelection(new Set([...dragBaseRef.current, ...indicesInRange(dragAnchorRef.current, index)]));
    } else {
      const base = event.metaKey || event.ctrlKey ? new Set(selection) : new Set<number>();
      base.add(index);
      dragBaseRef.current = base;
      dragAnchorRef.current = index;
      setSelection(base);
    }
    draggingRef.current = true;
    setDragging(true);
  };

  const onRowMouseEnter = (index: number) => {
    if (!draggingRef.current || dragAnchorRef.current === null) return;
    if (dragHoverRef.current === index) return;
    dragHoverRef.current = index;
    dragMovedRef.current = true;
    setSelection(new Set([...dragBaseRef.current, ...indicesInRange(dragAnchorRef.current, index)]));
  };

  const beginEdit = (r: number, c: number) => {
    const value = rows[r][c];
    setDraft(value === null || value === undefined ? "" : String(value));
    setEditing({ r, c });
  };

  const commit = async () => {
    if (!editing) return;
    const { r, c } = editing;
    const column = columns[c];
    const meta = metaByName.get(column);
    const original = rows[r][c];
    const same = original === null || original === undefined ? draft === "" : String(original) === draft;
    setEditing(null);
    if (same) return;

    const value = draft === "" && meta?.nullable ? null : draft;
    const key = `${r}:${c}`;
    setSaving((prev) => new Set(prev).add(key));
    try {
      await onUpdateCell(r, column, value);
    } catch {
      /* parent surfaces the error */
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div className={cn("scrollbar-thin relative h-full overflow-auto", dragging && "select-none")}>
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr>
            {selectable && (
              <th className="sticky left-0 z-30 w-8 border-b border-r bg-card px-2 py-1.5">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all rows"
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
            {columns.map((col) => {
              const meta = metaByName.get(col);
              const isPk = (primaryKey ?? []).includes(col);
              const isFk = fkByName.has(col);
              const sortDir = orderBy === col ? "asc" : orderBy === `-${col}` ? "desc" : null;
              return (
                <th
                  key={col}
                  onClick={() => onSort?.(col)}
                  className={cn(
                    "group border-b border-r bg-card px-3 py-1.5 text-left align-top font-medium",
                    onSort && "cursor-pointer select-none hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {isPk && <Key className="h-3 w-3 text-amber-500" />}
                    {isFk && !isPk && <Link2 className="h-3 w-3 text-sky-400" />}
                    <span className="truncate">{col}</span>
                    {sortDir === "asc" ? (
                      <ArrowUp className="h-3 w-3 shrink-0 text-primary" />
                    ) : sortDir === "desc" ? (
                      <ArrowDown className="h-3 w-3 shrink-0 text-primary" />
                    ) : onSort ? (
                      <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
                    ) : null}
                    {meta?.key === "UNI" && !isPk && (
                      <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                        UQ
                      </Badge>
                    )}
                  </div>
                  {meta && (
                    <div className="mt-0.5 truncate text-[10px] font-normal text-muted-foreground">
                      {meta.type}
                      {!meta.nullable && " · not null"}
                    </div>
                  )}
                </th>
              );
            })}
            <th className="sticky right-0 z-30 w-10 border-b border-l bg-card px-2 py-1.5" />
          </tr>
        </thead>
        <tbody
          onMouseMove={(event) => {
            if (!selectable || !draggingRef.current) return;
            const tr = (event.target as HTMLElement).closest("tr");
            const raw = tr?.getAttribute("data-row-index");
            if (raw !== null && raw !== undefined) onRowMouseEnter(Number(raw));
          }}
          onMouseUp={(event) => {
            // Finalize on the row under the pointer: the last mousemove before
            // mouseup can be coalesced, which would drop the end row.
            if (!selectable || !draggingRef.current || dragAnchorRef.current === null) return;
            const tr = (event.target as HTMLElement).closest("tr");
            const raw = tr?.getAttribute("data-row-index");
            if (raw === null || raw === undefined) return;
            const idx = Number(raw);
            dragHoverRef.current = idx;
            setSelection(new Set([...dragBaseRef.current, ...indicesInRange(dragAnchorRef.current, idx)]));
          }}
        >
          {rows.map((row, r) => {
            const isSelected = selection.has(r);
            return (
              <tr
                key={r}
                data-row-index={r}
                data-state={isSelected ? "selected" : undefined}
                className={cn("group hover:bg-muted/40", isSelected && "bg-primary/10 hover:bg-primary/15")}
                onMouseDown={(event) => onRowMouseDown(r, event)}
              >
                {selectable && (
                  <td
                    className={cn(
                      "sticky left-0 z-10 border-b border-r bg-card px-2 py-1 text-center group-hover:bg-muted",
                      isSelected && "bg-primary/10 group-hover:bg-primary/15"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(v) => toggleRow(r, Boolean(v))}
                      aria-label={`Select row ${r + 1}`}
                    />
                  </td>
                )}
                <td
                  className={cn(
                    "sticky z-10 border-b border-r bg-card px-2 py-1 text-right text-[11px] text-muted-foreground group-hover:bg-muted",
                    selectable ? "left-8" : "left-0",
                    isSelected && "bg-primary/10 group-hover:bg-primary/15"
                  )}
                >
                  {r + 1}
                </td>
                {row.map((cell, c) => {
                  const col = columns[c];
                  const isEditing = editing?.r === r && editing?.c === c;
                  const isSaving = saving.has(`${r}:${c}`);
                  const numeric = typeof cell === "number";
                  const fk = fkByName.get(col);
                  const meta = metaByName.get(col);
                  return (
                    <ContextMenu key={c}>
                      <ContextMenuTrigger asChild>
                        <td
                          className={cn(
                            "max-w-[420px] border-b border-r px-3 py-1 align-top",
                            numeric && "text-right tabular-nums",
                            !isEditing && "cursor-cell"
                          )}
                          onDoubleClick={() => {
                            if (dragMovedRef.current) {
                              dragMovedRef.current = false;
                              return;
                            }
                            if (!isEditing) beginEdit(r, c);
                          }}
                          title={isEditing ? undefined : cell === null ? "NULL" : String(cell)}
                        >
                          {isEditing ? (
                            <input
                              ref={inputRef}
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={commit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Tab") {
                                  e.preventDefault();
                                  void commit();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  setEditing(null);
                                }
                              }}
                              className={cn(
                                "w-full min-w-[80px] rounded border border-primary bg-background px-1.5 py-0.5 text-[13px] outline-none",
                                numeric && "text-right"
                              )}
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              <CellValue value={cell} />
                              {isSaving && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />}
                            </div>
                          )}
                        </td>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => beginEdit(r, c)}>
                          <Pencil /> Edit
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onViewCell?.(r, col)}>
                          <Eye /> View content
                        </ContextMenuItem>
                        {fk && cell !== null && cell !== undefined && (
                          <ContextMenuItem onClick={() => onJump?.(fk, cell)}>
                            <Link2 /> Go to {fk.refTable}.{fk.refColumn}
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem disabled={!meta?.nullable} onClick={() => void onUpdateCell(r, col, null).catch(() => {})}>
                          Set NULL
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => {
                            const text = cell === null || cell === undefined ? "NULL" : String(cell);
                            void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
                          }}
                        >
                          <Copy /> Copy value
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
                <td
                  className={cn(
                    "sticky right-0 z-10 border-b border-l bg-card px-1 py-1 text-center group-hover:bg-muted",
                    isSelected && "bg-primary/10 group-hover:bg-primary/15"
                  )}
                >
                  <button
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title="Delete row"
                    onClick={() => onDeleteRow(r)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 3 : 2)}
                className="px-3 py-10 text-center text-sm text-muted-foreground"
              >
                No rows in this table.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
