import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Key, Loader2, Trash2 } from "lucide-react";
import type { ColumnInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CellValue } from "@/components/CellValue";

interface Props {
  columns: string[];
  rows: unknown[][];
  columnsMeta: ColumnInfo[];
  primaryKey: string[];
  orderBy?: string;
  onSort?: (column: string) => void;
  onUpdateCell: (rowIndex: number, column: string, value: unknown) => Promise<void>;
  onDeleteRow: (rowIndex: number) => void;
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
  orderBy,
  onSort,
  onUpdateCell,
  onDeleteRow,
}: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const metaByName = useMemo(() => {
    const m = new Map<string, ColumnInfo>();
    columnsMeta.forEach((c) => m.set(c.name, c));
    return m;
  }, [columnsMeta]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

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
    const same =
      original === null || original === undefined
        ? draft === ""
        : String(original) === draft;
    setEditing(null);
    if (same) return;

    const value = draft === "" && meta?.nullable ? null : draft;
    const key = `${r}:${c}`;
    setSaving((prev) => new Set(prev).add(key));
    try {
      await onUpdateCell(r, column, value);
    } catch {
      // parent surfaces the error via toast
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const cancel = () => setEditing(null);

  return (
    <div className="scrollbar-thin relative h-full overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 w-10 border-b border-r bg-card px-2 py-1.5 text-right text-[11px] font-medium text-muted-foreground">
              #
            </th>
            {columns.map((col) => {
              const meta = metaByName.get(col);
              const isPk = primaryKey.includes(col);
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
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="group hover:bg-muted/40">
              <td className="sticky left-0 z-10 border-b border-r bg-card px-2 py-1 text-right text-[11px] text-muted-foreground group-hover:bg-muted">
                {r + 1}
              </td>
              {row.map((cell, c) => {
                const col = columns[c];
                const isEditing = editing?.r === r && editing?.c === c;
                const isSaving = saving.has(`${r}:${c}`);
                const numeric = typeof cell === "number";
                return (
                  <td
                    key={c}
                    className={cn(
                      "max-w-[420px] border-b border-r px-3 py-1 align-top",
                      numeric && "text-right tabular-nums",
                      !isEditing && "cursor-cell"
                    )}
                    onDoubleClick={() => !isEditing && beginEdit(r, c)}
                    title={isEditing ? undefined : cell === null ? "NULL" : String(cell)}
                  >
                    {isEditing ? (
                      <input
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void commit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancel();
                          } else if (e.key === "Tab") {
                            e.preventDefault();
                            void commit();
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
                );
              })}
              <td className="sticky right-0 z-10 border-b border-l bg-card px-1 py-1 text-center group-hover:bg-muted">
                <button
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  title="Delete row"
                  onClick={() => onDeleteRow(r)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + 2}
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
