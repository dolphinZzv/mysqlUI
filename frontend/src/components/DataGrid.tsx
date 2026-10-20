import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Columns3,
  Copy,
  CopyPlus,
  Eye,
  Key,
  Link2,
  Loader2,
  Pencil,
  Pin,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ColumnInfo, ForeignKeyInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { CellValue } from "@/components/CellValue";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  columnsMeta: ColumnInfo[];
  primaryKey: string[];
  foreignKeys?: ForeignKeyInfo[];
  tableName?: string;
  orderBy?: string;
  storageKey?: string;
  onSort?: (column: string) => void;
  onUpdateCell: (rowIndex: number, column: string, value: unknown) => Promise<void>;
  onDeleteRow: (rowIndex: number) => void;
  onDuplicateRow?: (rowIndex: number) => void;
  onViewCell?: (rowIndex: number, column: string) => void;
  onJump?: (foreignKey: ForeignKeyInfo, value: unknown) => void;
  onPasteRange?: (startRow: number, startColumn: number, grid: string[][]) => void;
  /** Row indices (page-local) that are currently selected. */
  selected?: Set<number>;
  onSelectedChange?: (next: Set<number>) => void;
}

interface Editing {
  r: number;
  c: number;
}

interface CellPos {
  r: number;
  c: number;
}

interface GridPrefs {
  widths: Record<string, number>;
  hidden: string[];
  frozen: string[];
}

const DEFAULT_WIDTH = 172;
const MIN_WIDTH = 70;
const MAX_WIDTH = 900;
const PREFS_PREFIX = "mysqlui.gridPrefs.";

function loadPrefs(key: string): GridPrefs {
  if (!key) return { widths: {}, hidden: [], frozen: [] };
  try {
    const raw = localStorage.getItem(PREFS_PREFIX + key);
    if (!raw) return { widths: {}, hidden: [], frozen: [] };
    const parsed = JSON.parse(raw) as Partial<GridPrefs>;
    return {
      widths: parsed.widths && typeof parsed.widths === "object" ? parsed.widths : {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      frozen: Array.isArray(parsed.frozen) ? parsed.frozen : [],
    };
  } catch {
    return { widths: {}, hidden: [], frozen: [] };
  }
}

function normalizeRange(a: CellPos, b: CellPos) {
  return {
    r1: Math.min(a.r, b.r),
    r2: Math.max(a.r, b.r),
    c1: Math.min(a.c, b.c),
    c2: Math.max(a.c, b.c),
  };
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseClipboard(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
  if (normalized.includes("\t")) {
    return normalized.split("\n").map((line) => line.split("\t"));
  }
  // Only treat input as CSV when it actually looks delimited; a single plain
  // value pastes into one cell.
  if (!normalized.includes(",")) return [[normalized]];
  return parseCSV(normalized);
}

export function DataGrid({
  columns,
  rows,
  columnsMeta,
  primaryKey,
  foreignKeys = [],
  tableName = "table",
  orderBy,
  storageKey = "",
  onSort,
  onUpdateCell,
  onDeleteRow,
  onDuplicateRow,
  onViewCell,
  onJump,
  onPasteRange,
  selected,
  onSelectedChange,
}: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [prefs, setPrefs] = useState<GridPrefs>(() => loadPrefs(storageKey));
  const [range, setRange] = useState<{ anchor: CellPos; focus: CellPos } | null>(null);
  const [draggingRange, setDraggingRange] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRangeRef = useRef(false);
  const resizingRef = useRef<{ column: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setPrefs(loadPrefs(storageKey));
    setRange(null);
  }, [storageKey]);

  const savePrefs = useCallback(
    (next: GridPrefs) => {
      setPrefs(next);
      if (!storageKey) return;
      try {
        localStorage.setItem(PREFS_PREFIX + storageKey, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
    },
    [storageKey]
  );

  const selection = selected ?? new Set<number>();
  const selectable = Boolean(onSelectedChange);

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

  const hidden = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);
  const frozenSet = useMemo(() => new Set(prefs.frozen), [prefs.frozen]);
  const visible = useMemo(
    () => columns.map((name, index) => ({ name, index })).filter((c) => !hidden.has(c.name)),
    [columns, hidden]
  );

  const widthOf = useCallback(
    (column: string) => {
      const w = prefs.widths[column];
      return Number.isFinite(w) && w >= MIN_WIDTH ? w : DEFAULT_WIDTH;
    },
    [prefs.widths]
  );

  const frozenLeft = useMemo(() => {
    const map = new Map<string, number>();
    let left = (selectable ? 32 : 0) + 40;
    for (const col of visible) {
      if (!frozenSet.has(col.name)) continue;
      map.set(col.name, left);
      left += widthOf(col.name);
    }
    return map;
  }, [visible, frozenSet, widthOf, selectable]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        setDragging(false);
      }
      if (dragRangeRef.current) {
        dragRangeRef.current = false;
        setDraggingRange(false);
      }
      if (resizingRef.current) {
        resizingRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
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
    // Data cells start a rectangular cell selection; the row gutter / row
    // number starts a row selection. This keeps both workflows available.
    if (target.closest("[data-cell]")) return;
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

  const valueText = (value: unknown) =>
    value === null || value === undefined ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value);

  const sqlLiteral = (value: unknown) => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  };

  const copyText = (text: string, message: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(message))
      .catch(() => toast.error("Clipboard is not available"));
  };

  const copyRowsTSV = (indices: number[]) => {
    const text = indices
      .sort((a, b) => a - b)
      .map((r) => rows[r].map(valueText).join("\t"))
      .join("\n");
    copyText(text, indices.length === 1 ? "Row copied" : `${indices.length} rows copied`);
  };

  const copyRangeTSV = useCallback(() => {
    if (!range) return;
    const box = normalizeRange(range.anchor, range.focus);
    const lines: string[] = [];
    for (let r = box.r1; r <= box.r2; r++) {
      lines.push(visible.slice(box.c1, box.c2 + 1).map((col) => valueText(rows[r]?.[col.index])).join("\t"));
    }
    copyText(lines.join("\n"), `${box.r2 - box.r1 + 1} × ${box.c2 - box.c1 + 1} range copied`);
  }, [range, visible, rows]);

  const rowInsertSQL = (r: number) => {
    const cols = columns.map((c) => `\`${c}\``).join(", ");
    const vals = rows[r].map(sqlLiteral).join(", ");
    return `INSERT INTO \`${tableName}\` (${cols}) VALUES (${vals});`;
  };

  const rowUpdateSQL = (r: number) => {
    if (primaryKey.length === 0) return "";
    const assignments = columns
      .filter((c) => !primaryKey.includes(c))
      .map((c) => {
        const idx = columns.indexOf(c);
        return `\`${c}\` = ${sqlLiteral(rows[r][idx])}`;
      });
    const where = primaryKey
      .map((c) => {
        const idx = columns.indexOf(c);
        return `\`${c}\` = ${sqlLiteral(rows[r][idx])}`;
      })
      .join(" AND ");
    return `UPDATE \`${tableName}\` SET ${assignments.join(", ")} WHERE ${where};`;
  };

  const onCellMouseDown = (r: number, visibleIndex: number, event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, [role=checkbox]")) return;
    if (window.getSelection()?.toString()) return;
    event.preventDefault();
    setEditing(null);
    if (event.shiftKey && range) {
      setRange({ anchor: range.anchor, focus: { r, c: visibleIndex } });
    } else {
      setRange({ anchor: { r, c: visibleIndex }, focus: { r, c: visibleIndex } });
    }
    dragRangeRef.current = true;
    setDraggingRange(true);
    gridRef.current?.focus();
  };

  const onCellMouseEnter = (r: number, visibleIndex: number) => {
    if (!dragRangeRef.current || !range) return;
    setRange((prev) => (prev ? { anchor: prev.anchor, focus: { r, c: visibleIndex } } : prev));
  };

  const moveFocus = (dr: number, dc: number, extend: boolean) => {
    if (rows.length === 0 || visible.length === 0) return;
    setRange((prev) => {
      const base = prev ?? { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
      const next = {
        r: Math.max(0, Math.min(rows.length - 1, base.focus.r + dr)),
        c: Math.max(0, Math.min(visible.length - 1, base.focus.c + dc)),
      };
      return { anchor: extend ? base.anchor : next, focus: next };
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable=true]")) return;
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === "c") {
      if (range) {
        event.preventDefault();
        copyRangeTSV();
      }
      return;
    }
    if (meta && event.key.toLowerCase() === "v") {
      if (!range || !onPasteRange) return;
      event.preventDefault();
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (!text) return;
          const grid = parseClipboard(text);
          const start = range.anchor;
          onPasteRange(start.r, visible[start.c]?.index ?? 0, grid);
        })
        .catch(() => toast.error("Clipboard read failed"));
      return;
    }
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveFocus(-1, 0, event.shiftKey);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveFocus(1, 0, event.shiftKey);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(0, -1, event.shiftKey);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveFocus(0, 1, event.shiftKey);
        break;
      case "Tab":
        event.preventDefault();
        moveFocus(0, event.shiftKey ? -1 : 1, false);
        break;
      case "Enter":
        event.preventDefault();
        moveFocus(event.shiftKey ? -1 : 1, 0, false);
        break;
      case "Escape":
        event.preventDefault();
        setRange(null);
        setEditing(null);
        break;
    }
  };

  const startResize = (column: string, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    resizingRef.current = { column, startX: event.clientX, startWidth: widthOf(column) };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (move: MouseEvent) => {
      const state = resizingRef.current;
      if (!state) return;
      const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, state.startWidth + move.clientX - state.startX));
      setPrefs((prev) => ({ ...prev, widths: { ...prev.widths, [state.column]: width } }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      resizingRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setPrefs((prev) => {
        if (storageKey) {
          try {
            localStorage.setItem(PREFS_PREFIX + storageKey, JSON.stringify(prev));
          } catch {
            /* ignore */
          }
        }
        return prev;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const setHidden = (column: string, hide: boolean) => {
    const next = hide
      ? Array.from(new Set([...prefs.hidden, column]))
      : prefs.hidden.filter((c) => c !== column);
    savePrefs({ ...prefs, hidden: next });
    if (hide) setRange(null);
  };

  const setFrozen = (column: string, freeze: boolean) => {
    const next = freeze
      ? Array.from(new Set([...prefs.frozen, column]))
      : prefs.frozen.filter((c) => c !== column);
    savePrefs({ ...prefs, frozen: next });
  };

  const freezeUpTo = (column: string) => {
    const names = visible.slice(0, visible.findIndex((c) => c.name === column) + 1).map((c) => c.name);
    savePrefs({ ...prefs, frozen: names });
  };

  const resetPrefs = () => {
    savePrefs({ widths: {}, hidden: [], frozen: [] });
    setRange(null);
  };

  const box = range ? normalizeRange(range.anchor, range.focus) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-muted/20 px-2 py-1 text-xs">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <Columns3 /> Columns ({visible.length}/{columns.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            {columns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column}
                checked={!hidden.has(column)}
                onCheckedChange={(checked) => setHidden(column, !checked)}
                onSelect={(e) => e.preventDefault()}
              >
                {column}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={resetPrefs}>
              <RotateCcw /> Reset widths, visibility and freeze
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <Pin /> Freeze ({prefs.frozen.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
            <DropdownMenuLabel>Keep columns at the left</DropdownMenuLabel>
            {visible.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.name}
                checked={frozenSet.has(column.name)}
                onCheckedChange={(checked) => setFrozen(column.name, checked)}
                onSelect={(e) => e.preventDefault()}
              >
                {column.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {range && box && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {box.r2 - box.r1 + 1}×{box.c2 - box.c1 + 1} selected · Ctrl/Cmd+C copy · Ctrl/Cmd+V paste · Esc clear
          </span>
        )}
      </div>
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          "scrollbar-thin relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40",
          (dragging || draggingRange) && "select-none"
        )}
      >
        <table className="w-max min-w-full table-fixed border-separate border-spacing-0 text-[13px]">
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
                style={{ width: 40, minWidth: 40, maxWidth: 40 }}
                className={cn(
                  "sticky z-30 border-b border-r bg-card px-2 py-1.5 text-right text-[11px] font-medium text-muted-foreground",
                  selectable ? "left-8" : "left-0"
                )}
              >
                #
              </th>
              {visible.map((col) => {
                const meta = metaByName.get(col.name);
                const isPk = (primaryKey ?? []).includes(col.name);
                const isFk = fkByName.has(col.name);
                const sortDir = orderBy === col.name ? "asc" : orderBy === `-${col.name}` ? "desc" : null;
                const frozen = frozenSet.has(col.name);
                const width = widthOf(col.name);
                return (
                  <ContextMenu key={col.name}>
                    <ContextMenuTrigger asChild>
                      <th
                        onClick={() => onSort?.(col.name)}
                        style={{
                          width,
                          minWidth: width,
                          maxWidth: width,
                          ...(frozen ? { position: "sticky", left: frozenLeft.get(col.name) ?? 0 } : {}),
                        }}
                        className={cn(
                          "group relative border-b border-r bg-card px-3 py-1.5 text-left align-top font-medium",
                          onSort && "cursor-pointer select-none hover:bg-muted/50",
                          frozen && "z-30 shadow-[1px_0_0_0_var(--border)]"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {isPk && <Key className="h-3 w-3 shrink-0 text-amber-500" />}
                          {isFk && !isPk && <Link2 className="h-3 w-3 shrink-0 text-sky-400" />}
                          <span className="truncate">{col.name}</span>
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
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          title="Drag to resize"
                          onMouseDown={(e) => startResize(col.name, e)}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 transition-opacity hover:bg-primary/40 group-hover:opacity-100"
                        />
                      </th>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => setHidden(col.name, true)}>
                        <Eye /> Hide column
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => freezeUpTo(col.name)}>
                        <Pin /> Freeze up to here
                      </ContextMenuItem>
                      <ContextMenuItem disabled={!frozen} onClick={() => setFrozen(col.name, false)}>
                        <Pin /> Unfreeze column
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
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
                    style={{ width: 40, minWidth: 40, maxWidth: 40 }}
                    className={cn(
                      "sticky z-10 cursor-pointer border-b border-r bg-card px-2 py-1 text-right text-[11px] text-muted-foreground group-hover:bg-muted",
                      selectable ? "left-8" : "left-0",
                      isSelected && "bg-primary/10 group-hover:bg-primary/15"
                    )}
                  >
                    {r + 1}
                  </td>
                  {visible.map((col, visibleIndex) => {
                    const c = col.index;
                    const colName = col.name;
                    const cell = row[c];
                    const isEditing = editing?.r === r && editing?.c === c;
                    const isSaving = saving.has(`${r}:${c}`);
                    const numeric = typeof cell === "number";
                    const fk = fkByName.get(colName);
                    const meta = metaByName.get(colName);
                    const inRange = box && r >= box.r1 && r <= box.r2 && visibleIndex >= box.c1 && visibleIndex <= box.c2;
                    const isFocus = range?.focus.r === r && range?.focus.c === visibleIndex;
                    const frozen = frozenSet.has(colName);
                    const width = widthOf(colName);
                    return (
                      <ContextMenu key={c}>
                        <ContextMenuTrigger asChild>
                          <td
                            data-cell
                            data-row-index={r}
                            data-col-index={visibleIndex}
                            style={{
                              width,
                              minWidth: width,
                              maxWidth: width,
                              ...(frozen ? { position: "sticky", left: frozenLeft.get(colName) ?? 0 } : {}),
                            }}
                            className={cn(
                              "border-b border-r px-3 py-1 align-top",
                              numeric && "text-right tabular-nums",
                              !isEditing && "cursor-cell",
                              frozen && "z-10 bg-background group-hover:bg-muted/40",
                              inRange && "bg-primary/15",
                              isFocus && "outline outline-1 -outline-offset-1 outline-primary"
                            )}
                            onMouseDown={(event) => onCellMouseDown(r, visibleIndex, event)}
                            onMouseEnter={() => onCellMouseEnter(r, visibleIndex)}
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
                              <div className="flex items-center gap-1 overflow-hidden">
                                <CellValue value={cell} />
                                {isSaving && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />}
                              </div>
                            )}
                          </td>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          {box && (box.r2 > box.r1 || box.c2 > box.c1) && (
                            <ContextMenuItem onClick={copyRangeTSV}>
                              <Copy /> Copy {box.r2 - box.r1 + 1}×{box.c2 - box.c1 + 1} range as TSV
                            </ContextMenuItem>
                          )}
                          {selection.size > 1 && (
                            <ContextMenuItem onClick={() => copyRowsTSV([...selection])}>
                              <Copy /> Copy selected rows
                            </ContextMenuItem>
                          )}
                          <ContextMenuItem onClick={() => copyRowsTSV([r])}>
                            <Copy /> Copy row
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => copyText(rowInsertSQL(r), "INSERT copied")}>
                            <CopyPlus /> Copy as INSERT
                          </ContextMenuItem>
                          <ContextMenuItem
                            disabled={primaryKey.length === 0}
                            onClick={() => copyText(rowUpdateSQL(r), "UPDATE copied")}
                          >
                            <CopyPlus /> Copy as UPDATE
                          </ContextMenuItem>
                          {onDuplicateRow && (
                            <ContextMenuItem onClick={() => onDuplicateRow(r)}>
                              <CopyPlus /> Duplicate row
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => beginEdit(r, c)}>
                            <Pencil /> Edit
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => onViewCell?.(r, colName)}>
                            <Eye /> View content
                          </ContextMenuItem>
                          {fk && cell !== null && cell !== undefined && (
                            <ContextMenuItem onClick={() => onJump?.(fk, cell)}>
                              <Link2 /> Go to {fk.refTable}.{fk.refColumn}
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            disabled={!meta?.nullable}
                            onClick={() => void onUpdateCell(r, colName, null).catch(() => {})}
                          >
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
                  colSpan={visible.length + (selectable ? 3 : 2)}
                  className="px-3 py-10 text-center text-sm text-muted-foreground"
                >
                  No rows in this table.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
