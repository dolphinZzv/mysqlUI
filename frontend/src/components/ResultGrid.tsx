import { useMemo, useRef, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CellValue } from "@/components/CellValue";
import { Input } from "@/components/ui/input";

interface Props {
  columns: string[];
  rows: unknown[][];
}

export function ResultGrid({ columns, rows }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const timer = useRef<number | undefined>(undefined);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative border-b px-3 py-1.5">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-7 w-[240px] pl-7 text-xs" placeholder="Filter results" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
    <div className="scrollbar-thin relative min-h-0 flex-1 overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 w-10 border-b border-r bg-card px-2 py-1.5 text-right text-[11px] font-medium text-muted-foreground">
              #
            </th>
            {columns.map((col) => (
              <th
                key={col}
                onClick={() => {
                  const idx = columns.indexOf(col);
                  if (sortCol === idx) setSortDir((d) => (d === 1 ? -1 : 1));
                  else {
                    setSortCol(idx);
                    setSortDir(1);
                  }
                }}
                className="cursor-pointer border-b border-r bg-card px-3 py-1.5 text-left font-medium hover:bg-muted/40"
              >
                <span className="block max-w-[360px] truncate">{col}{sortCol === columns.indexOf(col) ? (sortDir === 1 ? " ↑" : " ↓") : ""}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayed.map(({ row, index: r }) => (
            <tr key={r} className="group hover:bg-muted/40">
              <td className="sticky left-0 z-10 border-b border-r bg-card px-2 py-1 text-right text-[11px] text-muted-foreground group-hover:bg-muted">
                {r + 1}
              </td>
              {row.map((cell, c) => {
                const numeric = typeof cell === "number";
                const key = `${r}:${c}`;
                return (
                  <td
                    key={c}
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
                        {copied === key ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          {displayed.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + 1}
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
