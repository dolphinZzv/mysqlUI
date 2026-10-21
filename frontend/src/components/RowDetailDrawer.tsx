import { useEffect, useState } from "react";
import { Copy, ExternalLink, Eye, Link2, Pencil, Save, X } from "lucide-react";
import type { ColumnInfo, ForeignKeyInfo } from "@/lib/types";
import { CellValue } from "@/components/CellValue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: unknown[] | null;
  rowIndex: number;
  columns: string[];
  columnsMeta: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  onUpdateCell: (rowIndex: number, column: string, value: unknown) => Promise<void>;
  onViewCell: (rowIndex: number, column: string) => void;
  onJump: (foreignKey: ForeignKeyInfo, value: unknown) => void;
}

export function RowDetailDrawer({
  open,
  onOpenChange,
  row,
  rowIndex,
  columns,
  columnsMeta,
  foreignKeys,
  onUpdateCell,
  onViewCell,
  onJump,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setDraft("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  if (!open || !row) return null;
  const fkByColumn = new Map(foreignKeys.map((fk) => [fk.column, fk]));
  const metaByColumn = new Map(columnsMeta.map((meta) => [meta.name, meta]));

  const save = async (column: string) => {
    const meta = metaByColumn.get(column);
    const value = draft === "" && meta?.nullable ? null : draft;
    setSaving(true);
    try {
      await onUpdateCell(rowIndex, column, value);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <aside className="relative z-10 flex h-full w-full max-w-lg flex-col border-l bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Eye className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Row #{rowIndex + 1}</span>
          <span className="text-xs text-muted-foreground">{columns.length} columns</span>
          <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={() => onOpenChange(false)}>
            <X />
          </Button>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
          <div className="space-y-2">
            {columns.map((column, index) => {
              const value = row[index];
              const meta = metaByColumn.get(column);
              const fk = fkByColumn.get(column);
              const isEditing = editing === column;
              return (
                <div key={column} className="rounded-md border bg-card px-3 py-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-xs font-medium">{column}</span>
                    {meta && <span className="text-[10px] text-muted-foreground">{meta.type}</span>}
                    {meta && !meta.nullable && <span className="text-[10px] text-amber-500">not null</span>}
                    <div className="ml-auto flex items-center gap-0.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Copy value"
                        onClick={() => {
                          const text = value === null || value === undefined ? "NULL" : String(value);
                          void navigator.clipboard.writeText(text);
                        }}
                      >
                        <Copy />
                      </Button>
                      <Button size="icon-sm" variant="ghost" title="View full content" onClick={() => onViewCell(rowIndex, column)}>
                        <ExternalLink />
                      </Button>
                      {fk && value !== null && value !== undefined && (
                        <Button size="icon-sm" variant="ghost" title={`Go to ${fk.refTable}.${fk.refColumn}`} onClick={() => onJump(fk, value)}>
                          <Link2 />
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Edit"
                        onClick={() => {
                          setEditing(isEditing ? null : column);
                          setDraft(value === null || value === undefined ? "" : String(value));
                        }}
                      >
                        <Pencil />
                      </Button>
                    </div>
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        autoFocus
                        className="h-7 font-mono text-xs"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void save(column);
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                      <Button size="icon-sm" variant="outline" disabled={saving} onClick={() => void save(column)}>
                        <Save />
                      </Button>
                    </div>
                  ) : (
                    <div className="max-h-40 overflow-auto break-all text-[12px]">
                      <CellValue value={value} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="border-t px-4 py-2 text-[10px] text-muted-foreground">
          Esc closes the drawer. Edits join the pending batch until you commit.
        </div>
      </aside>
    </div>
  );
}
