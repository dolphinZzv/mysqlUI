import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Minus, Plus, RefreshCw, Share2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ErdResponse } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  connectionId: string;
  database: string;
}

const BOX_W = 170;
const BOX_H = 46;
const GAP_X = 60;
const GAP_Y = 40;

export function ErdView({ connectionId, database }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<ErdResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 20, y: 20 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.erd(connectionId, database));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database]);

  const layout = useMemo(() => {
    const tables = data?.tables ?? [];
    const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
    const positions = new Map<string, { x: number; y: number }>();
    tables.forEach((tb, i) => {
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      positions.set(tb.name, {
        x: offset.x + cx * (BOX_W + GAP_X),
        y: offset.y + cy * (BOX_H + GAP_Y),
      });
    });
    return positions;
  }, [data, offset]);

  const width = useMemo(() => {
    const tables = data?.tables.length ?? 0;
    const cols = Math.max(1, Math.ceil(Math.sqrt(tables)));
    return cols * (BOX_W + GAP_X) + 80;
  }, [data]);

  const height = useMemo(() => {
    const tables = data?.tables.length ?? 0;
    const cols = Math.max(1, Math.ceil(Math.sqrt(tables)));
    const rows = Math.max(1, Math.ceil(tables / cols));
    return rows * (BOX_H + GAP_Y) + 80;
  }, [data]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Share2 className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t("erd.title", "ER diagram")}</span>
        <span className="font-mono text-xs text-muted-foreground">{database}</span>
        {data && (
          <>
            <Badge variant="secondary">{data.tables.length} {t("erd.tables", "tables")}</Badge>
            <Badge variant="secondary">{data.edges.length} {t("erd.relations", "relations")}</Badge>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="icon-sm" variant="outline" onClick={() => setScale((s) => Math.max(0.3, +(s - 0.1).toFixed(2)))}>
            <Minus />
          </Button>
          <span className="w-10 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
          <Button size="icon-sm" variant="outline" onClick={() => setScale((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))}>
            <Plus />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setScale(1);
              setOffset({ x: 20, y: 20 });
            }}
          >
            {t("erd.reset", "Reset")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      <div
        className="scrollbar-thin relative min-h-0 flex-1 cursor-grab overflow-auto bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:16px_16px] active:cursor-grabbing"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-erd-box]")) return;
          drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
        }}
        onMouseMove={(e) => {
          if (!drag.current) return;
          setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        {loading && !data ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <svg width={width * scale} height={height * scale} className="block">
            <g transform={`scale(${scale})`}>
              <defs>
                <marker id="erd-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                  <path d="M0,0 L9,3 L0,6 Z" className="fill-primary" />
                </marker>
              </defs>

              {data?.edges.map((edge, i) => {
                const from = layout.get(edge.fromTable);
                const to = layout.get(edge.toTable);
                if (!from || !to) return null;
                const x1 = from.x + BOX_W / 2;
                const y1 = from.y + BOX_H / 2;
                const x2 = to.x + BOX_W / 2;
                const y2 = to.y + BOX_H / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <g key={`${edge.constraint}-${i}`}>
                    <path
                      d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      className="stroke-primary/60"
                      strokeWidth={1.4}
                      markerEnd="url(#erd-arrow)"
                    />
                    <title>
                      {edge.fromTable}.{edge.fromColumn} → {edge.toTable}.{edge.toColumn}
                    </title>
                  </g>
                );
              })}

              {data?.tables.map((tb) => {
                const p = layout.get(tb.name);
                if (!p) return null;
                return (
                  <g key={tb.name} data-erd-box transform={`translate(${p.x},${p.y})`}>
                    <rect
                      width={BOX_W}
                      height={BOX_H}
                      rx={8}
                      className="fill-card stroke-border"
                      strokeWidth={1}
                    />
                    <rect width={BOX_W} height={22} rx={8} className="fill-primary/15" />
                    <text x={10} y={15} className="fill-foreground text-[11px] font-medium">
                      {tb.name.length > 22 ? tb.name.slice(0, 21) + "…" : tb.name}
                    </text>
                    <text x={10} y={37} className="fill-muted-foreground text-[10px]">
                      {data?.edges.filter((e) => e.fromTable === tb.name).length ?? 0} FK
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
