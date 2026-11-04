import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Minus, Plus, RefreshCw, Share2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ErdEdge, ErdResponse } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  connectionId: string;
  database: string;
}

const BOX_W = 180;
const BOX_H = 52;
const GAP_X = 70;
const GAP_Y = 52;
const PAD = 70;

type Position = { x: number; y: number };
type TableCounts = { fk: number; inferred: number };

function truncateName(name: string, max = 24) {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

function edgePairKey(edge: ErdEdge) {
  return edge.fromTable <= edge.toTable
    ? `${edge.fromTable}\u0000${edge.toTable}`
    : `${edge.toTable}\u0000${edge.fromTable}`;
}

function edgePath(edge: ErdEdge, from: Position, to: Position, bend: number) {
  if (edge.fromTable === edge.toTable) {
    // Self-referencing relationship: draw a loop outside the top-right corner.
    const sx = from.x + BOX_W * 0.62;
    const sy = from.y;
    const ex = from.x + BOX_W + 3;
    const ey = from.y + BOX_H * 0.68;
    return `M ${sx} ${sy} C ${from.x + BOX_W + 38} ${from.y - 52}, ${from.x + BOX_W + 62} ${from.y + BOX_H + 12}, ${ex} ${ey}`;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const dir = dx >= 0 ? 1 : -1;
    const x1 = dir > 0 ? from.x + BOX_W : from.x;
    const y1 = from.y + BOX_H / 2;
    const x2 = dir > 0 ? to.x - 3 : to.x + BOX_W + 3;
    const y2 = to.y + BOX_H / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1 + bend}, ${mx} ${y2 + bend}, ${x2} ${y2}`;
  }

  const dir = dy >= 0 ? 1 : -1;
  const x1 = from.x + BOX_W / 2;
  const y1 = dir > 0 ? from.y + BOX_H : from.y;
  const x2 = to.x + BOX_W / 2;
  const y2 = dir > 0 ? to.y - 3 : to.y + BOX_H + 3;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1 + bend} ${my}, ${x2 + bend} ${my}, ${x2} ${y2}`;
}

export function ErdView({ connectionId, database }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<ErdResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [showInferred, setShowInferred] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const loadSeq = useRef(0);
  const uid = useId().replace(/:/g, "");
  const fkMarker = `erd-arrow-fk-${uid}`;
  const inferredMarker = `erd-arrow-inferred-${uid}`;

  const load = async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const res = await api.erd(connectionId, database);
      if (seq === loadSeq.current) setData(res);
    } catch (err) {
      if (seq === loadSeq.current) toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    setData(null);
    setScale(1);
    scrollRef.current?.scrollTo({ left: 0, top: 0 });
    void load();
    return () => {
      // Ignore responses from the previous connection/database.
      loadSeq.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database]);

  const allEdges = data?.edges ?? [];
  const inferredCount = allEdges.filter((e) => e.kind === "inferred").length;

  const edges = useMemo(
    () => allEdges.filter((e) => showInferred || e.kind !== "inferred"),
    [allEdges, showInferred]
  );

  const layout = useMemo(() => {
    const tables = data?.tables ?? [];
    const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
    const rows = Math.max(1, Math.ceil(tables.length / cols));
    const positions = new Map<string, Position>();
    tables.forEach((tb, i) => {
      positions.set(tb.name, {
        x: PAD + (i % cols) * (BOX_W + GAP_X),
        y: PAD + Math.floor(i / cols) * (BOX_H + GAP_Y),
      });
    });
    return {
      positions,
      width: PAD * 2 + cols * BOX_W + (cols - 1) * GAP_X,
      height: PAD * 2 + rows * BOX_H + (rows - 1) * GAP_Y,
    };
  }, [data]);

  const tableCounts = useMemo(() => {
    const counts = new Map<string, TableCounts>();
    const add = (table: string, inferred: boolean) => {
      const current = counts.get(table) ?? { fk: 0, inferred: 0 };
      if (inferred) current.inferred += 1;
      else current.fk += 1;
      counts.set(table, current);
    };
    for (const edge of allEdges) {
      const inferred = edge.kind === "inferred";
      add(edge.fromTable, inferred);
      if (edge.toTable !== edge.fromTable) add(edge.toTable, inferred);
    }
    return counts;
  }, [allEdges]);

  const edgeBends = useMemo(() => {
    const totals = new Map<string, number>();
    for (const edge of edges) {
      if (edge.fromTable === edge.toTable) continue;
      const key = edgePairKey(edge);
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    const bends = new Map<number, number>();
    edges.forEach((edge, i) => {
      if (edge.fromTable === edge.toTable) return;
      const key = edgePairKey(edge);
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      const total = totals.get(key) ?? 1;
      if (total > 1) bends.set(i, (index - (total - 1) / 2) * 16);
    });
    return bends;
  }, [edges]);

  const edgeTitle = (edge: ErdEdge) => {
    const kind =
      edge.kind === "inferred"
        ? `${t("erd.inferred", "Inferred")}${edge.confidence ? ` (${edge.confidence})` : ""}`
        : t("erd.foreignKey", "Foreign key");
    return `${edge.fromTable}.${edge.fromColumn} → ${edge.toTable}.${edge.toColumn}\n${kind}${
      edge.constraint ? ` · ${edge.constraint}` : ""
    }`;
  };

  const resetView = () => {
    setScale(1);
    scrollRef.current?.scrollTo({ left: 0, top: 0 });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Share2 className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t("erd.title", "ER diagram")}</span>
        <span className="font-mono text-xs text-muted-foreground">{database}</span>
        {data && (
          <>
            <Badge variant="secondary">
              {data.tables.length} {t("erd.tables", "tables")}
            </Badge>
            <Badge variant="secondary">
              {data.edges.length} {t("erd.relations", "relations")}
            </Badge>
          </>
        )}
        <div className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            id={`erd-inferred-${uid}`}
            checked={showInferred}
            disabled={inferredCount === 0}
            onCheckedChange={(v) => setShowInferred(Boolean(v))}
          />
          <label htmlFor={`erd-inferred-${uid}`} className="cursor-pointer">
            {t("erd.showInferred", "Inferred")}
            {inferredCount > 0 && <span className="ml-1 tabular-nums">({inferredCount})</span>}
          </label>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="outline"
            title={t("erd.zoomOut", "Zoom out")}
            onClick={() => setScale((s) => Math.max(0.3, +(s - 0.1).toFixed(2)))}
          >
            <Minus />
          </Button>
          <span className="w-10 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
          <Button
            size="icon-sm"
            variant="outline"
            title={t("erd.zoomIn", "Zoom in")}
            onClick={() => setScale((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))}
          >
            <Plus />
          </Button>
          <Button size="sm" variant="outline" onClick={resetView}>
            {t("erd.reset", "Reset")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
        {data && data.tables.length > 0 && data.edges.length === 0 && (
          <span className="w-full text-xs text-muted-foreground">
            {t("erd.noRelations", "No foreign keys or inferable relationships found.")}
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-thin relative min-h-0 flex-1 cursor-grab select-none overflow-auto bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:16px_16px] active:cursor-grabbing"
        onMouseDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest("[data-erd-box]")) return;
          const el = scrollRef.current;
          if (!el) return;
          drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        }}
        onMouseMove={(e) => {
          const el = scrollRef.current;
          const d = drag.current;
          if (!el || !d) return;
          el.scrollLeft = d.left - (e.clientX - d.x);
          el.scrollTop = d.top - (e.clientY - d.y);
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        {loading && !data ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.tables.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("erd.empty", "No tables in this database.")}
          </div>
        ) : (
          <svg width={layout.width * scale} height={layout.height * scale} className="block">
            <g transform={`scale(${scale})`}>
              <defs>
                <marker
                  id={fkMarker}
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L9,3 L0,6 Z" className="fill-primary" />
                </marker>
                <marker
                  id={inferredMarker}
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L9,3 L0,6 Z" className="fill-amber-500" />
                </marker>
              </defs>

              {edges.map((edge, i) => {
                const from = layout.positions.get(edge.fromTable);
                const to = layout.positions.get(edge.toTable);
                if (!from || !to) return null;
                const inferred = edge.kind === "inferred";
                return (
                  <g key={`${edge.fromTable}-${edge.fromColumn}-${edge.toTable}-${edge.toColumn}-${edge.constraint}-${i}`}>
                    <title>{edgeTitle(edge)}</title>
                    <path
                      d={edgePath(edge, from, to, edgeBends.get(i) ?? 0)}
                      fill="none"
                      className={inferred ? "stroke-amber-500/75" : "stroke-primary/60"}
                      strokeWidth={inferred ? 1.3 : 1.5}
                      strokeDasharray={inferred ? "5 4" : undefined}
                      markerEnd={`url(#${inferred ? inferredMarker : fkMarker})`}
                    />
                  </g>
                );
              })}

              {data.tables.map((tb) => {
                const p = layout.positions.get(tb.name);
                if (!p) return null;
                const counts = tableCounts.get(tb.name) ?? { fk: 0, inferred: 0 };
                const relationText = [
                  `${counts.fk} FK`,
                  counts.inferred ? `${counts.inferred} ${t("erd.inferredShort", "inferred")}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
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
                    <rect y={14} width={BOX_W} height={8} className="fill-primary/15" />
                    <text x={10} y={15} className="fill-foreground text-[11px] font-medium">
                      {truncateName(tb.name)}
                    </text>
                    <text x={10} y={38} className="fill-muted-foreground text-[10px]">
                      {relationText}
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
