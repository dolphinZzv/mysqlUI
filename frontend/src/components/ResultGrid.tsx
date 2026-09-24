import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { CellValue } from "@/components/CellValue";

interface Props {
  columns: string[];
  rows: unknown[][];
}

export function ResultGrid({ columns, rows }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const copyCell = (value: unknown, key: string) => {
    const text = value === null || value === undefined ? "NULL" : String(value);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1200);
    });
  };

  return (
    <div className="scrollbar-thin relative h-full overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 w-10 border-b border-r bg-card px-2 py-1.5 text-right text-[11px] font-medium text-muted-foreground">
              #
            </th>
            {columns.map((col) => (
              <th
                key={col}
                className="border-b border-r bg-card px-3 py-1.5 text-left font-medium"
              >
                <span className="block max-w-[360px] truncate">{col}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
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
          {rows.length === 0 && (
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
  );
}
