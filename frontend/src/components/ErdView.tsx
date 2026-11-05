import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LayoutGrid, Loader2, Maximize2, Minus, Plus, RefreshCw, Search, Share2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ColumnDefInput, ErdColumn, ErdEdge, ErdResponse, ErdTable } from "@/lib/types";
import { emptyColumn, normalizeInformationSchemaDefault, splitType } from "@/lib/schema";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ColumnDialog } from "@/components/ColumnDialog";

interface Props {
  connectionId: string;
  database: string;
}

const BOX_W = 250;
const HEADER_H = 30;
const COLUMN_H = 21;
const FOOTER_H = 28;
const GAP_X = 64;
const GAP_Y = 48;
const PAD = 70;

type Position = { x: number; y: number; height: number };
type TablePosition = { x: number; y: number };
type TableCounts = { fk: number; inferred: number };

const EMPTY_POSITIONS: Record<string, TablePosition> = {};

function loadErdPositions(key: string): Record<string, TablePosition> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const positions: Record<string, TablePosition> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const x = (value as { x?: unknown }).x;
      const y = (value as { y?: unknown }).y;
      if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
        positions[name] = { x, y };
      }
    }
    return positions;
  } catch {
    return {};
  }
}

function truncateName(name: string, max = 24) {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

function tableHeight(table: ErdTable) {
  return HEADER_H + Math.max(1, table.columns.length) * COLUMN_H + FOOTER_H;
}

function isGeneratedColumn(column: ErdColumn) {
  return /(VIRTUAL|STORED) GENERATED/i.test(column.extra ?? "");
}

function toColumnDef(column: ErdColumn): ColumnDefInput {
  const { base, length } = splitType(column.type);
  return {
    name: column.name,
    type: base || column.type,
    length,
    nullable: column.nullable,
    autoIncrement: /auto_increment/i.test(column.extra ?? ""),
    primaryKey: column.key === "PRI",
    unique: column.key === "UNI",
    default: normalizeInformationSchemaDefault(column.default),
    hasDefault: column.default !== null && column.default !== undefined,
    comment: column.comment ?? "",
    unsigned: /\bunsigned\b/i.test(column.type),
  };
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
    const ey = from.y + from.height * 0.68;
    return `M ${sx} ${sy} C ${from.x + BOX_W + 38} ${from.y - 52}, ${from.x + BOX_W + 62} ${from.y + from.height + 12}, ${ex} ${ey}`;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const dir = dx >= 0 ? 1 : -1;
    const x1 = dir > 0 ? from.x + BOX_W : from.x;
    const y1 = from.y + from.height / 2;
    const x2 = dir > 0 ? to.x - 3 : to.x + BOX_W + 3;
    const y2 = to.y + to.height / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1 + bend}, ${mx} ${y2 + bend}, ${x2} ${y2}`;
  }

  const dir = dy >= 0 ? 1 : -1;
  const x1 = from.x + BOX_W / 2;
  const y1 = dir > 0 ? from.y + from.height : from.y;
  const x2 = to.x + BOX_W / 2;
  const y2 = dir > 0 ? to.y - 3 : to.y + to.height + 3;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1 + bend} ${my}, ${x2 + bend} ${my}, ${x2} ${y2}`;
}

interface ColumnEditState {
  open: boolean;
  mode: "add" | "modify";
  table: string;
  column: ColumnDefInput;
  existingNames: string[];
}

export function ErdView({ connectionId, database }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<ErdResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [showInferred, setShowInferred] = useState(true);
  const [search, setSearch] = useState("");
  const [columnEdit, setColumnEdit] = useState<ColumnEditState | null>(null);
  const [draggingTable, setDraggingTable] = useState<string | null>(null);
  const positionsKey = `mysqlui.erd.positions:${connectionId}:${database}`;
  const [positionsState, setPositionsState] = useState<{ key: string; positions: Record<string, TablePosition> }>(() => ({
    key: positionsKey,
    positions: loadErdPositions(positionsKey),
  }));
  const manualPositions = positionsState.key === positionsKey ? positionsState.positions : EMPTY_POSITIONS;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const tableDrag = useRef<{
    name: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    scale: number;
  } | null>(null);
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

  useEffect(() => {
    if (positionsState.key === positionsKey) return;
    setPositionsState({ key: positionsKey, positions: loadErdPositions(positionsKey) });
  }, [positionsKey, positionsState.key]);

  useEffect(() => {
    if (positionsState.key !== positionsKey) return;
    try {
      localStorage.setItem(positionsKey, JSON.stringify(positionsState.positions));
    } catch {
      /* ignore unavailable storage */
    }
  }, [positionsKey, positionsState]);

  const updateTablePosition = useCallback(
    (name: string, position: TablePosition) => {
      setPositionsState((previous) => {
        const base = previous.key === positionsKey ? previous.positions : loadErdPositions(positionsKey);
        return { key: positionsKey, positions: { ...base, [name]: position } };
      });
    },
    [positionsKey]
  );

  useEffect(() => {
    if (!draggingTable) return;
    const onMove = (event: MouseEvent) => {
      const current = tableDrag.current;
      if (!current) return;
      const dx = (event.clientX - current.startX) / current.scale;
      const dy = (event.clientY - current.startY) / current.scale;
      updateTablePosition(current.name, {
        x: Math.max(PAD, current.origX + dx),
        y: Math.max(PAD, current.origY + dy),
      });
    };
    const stop = () => {
      tableDrag.current = null;
      setDraggingTable(null);
    };
    const onBlur = () => stop();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", onBlur);
    };
  }, [draggingTable, updateTablePosition]);

  const beginTableDrag = (table: ErdTable, position: Position, event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    tableDrag.current = {
      name: table.name,
      startX: event.clientX,
      startY: event.clientY,
      origX: position.x,
      origY: position.y,
      scale,
    };
    setDraggingTable(table.name);
  };

  const allEdges = data?.edges ?? [];
  const inferredCount = allEdges.filter((e) => e.kind === "inferred").length;
  const connectedTables = useMemo(() => {
    const connected = new Set<string>();
    for (const edge of allEdges) {
      connected.add(edge.fromTable);
      connected.add(edge.toTable);
    }
    return connected;
  }, [allEdges]);
  const unconnectedCount = data?.tables.filter((table) => !connectedTables.has(table.name)).length ?? 0;
  const visibleTables = useMemo(() => {
    const tables = data?.tables ?? [];
    const connected = tables.filter((table) => connectedTables.has(table.name));
    const unconnected = tables.filter((table) => !connectedTables.has(table.name));
    // Always keep dictionary / lookup tables in the diagram. They are grouped
    // after connected tables so they do not get lost in the middle.
    return [...connected, ...unconnected];
  }, [data, connectedTables]);

  const edges = useMemo(
    () => allEdges.filter((e) => showInferred || e.kind !== "inferred"),
    [allEdges, showInferred]
  );

  const searchQuery = search.trim().toLowerCase();
  const matchedTableNames = useMemo(() => {
    if (!searchQuery) return null;
    const matches = new Set<string>();
    for (const table of visibleTables) {
      if (
        table.name.toLowerCase().includes(searchQuery) ||
        table.columns.some((column) => column.name.toLowerCase().includes(searchQuery))
      ) {
        matches.add(table.name);
      }
    }
    return matches;
  }, [visibleTables, searchQuery]);
  const firstMatch = useMemo(
    () => (matchedTableNames ? visibleTables.find((table) => matchedTableNames.has(table.name))?.name : undefined),
    [matchedTableNames, visibleTables]
  );

  const layout = useMemo(() => {
    const tables = visibleTables;
    if (tables.length === 0) {
      return { positions: new Map<string, Position>(), width: PAD * 2 + BOX_W, height: PAD * 2 };
    }
    const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
    const heights = tables.map(tableHeight);
    const rowHeights: number[] = [];
    tables.forEach((_, i) => {
      const row = Math.floor(i / cols);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, heights[i]);
    });
    const rowY: number[] = [];
    let y = PAD;
    rowHeights.forEach((height) => {
      rowY.push(y);
      y += height + GAP_Y;
    });

    const positions = new Map<string, Position>();
    tables.forEach((table, i) => {
      const manual = manualPositions[table.name];
      positions.set(table.name, {
        x: manual?.x ?? PAD + (i % cols) * (BOX_W + GAP_X),
        y: manual?.y ?? rowY[Math.floor(i / cols)],
        height: heights[i],
      });
    });
    let maxX = 0;
    let maxY = 0;
    positions.forEach((position) => {
      maxX = Math.max(maxX, position.x + BOX_W);
      maxY = Math.max(maxY, position.y + position.height);
    });
    return {
      positions,
      width: Math.max(PAD * 2 + cols * BOX_W + (cols - 1) * GAP_X, maxX + PAD),
      height: Math.max(y - GAP_Y + PAD, maxY + PAD),
    };
  }, [visibleTables, manualPositions]);

  useEffect(() => {
    if (!searchQuery || !firstMatch) return;
    const position = layout.positions.get(firstMatch);
    const element = scrollRef.current;
    if (!position || !element) return;
    element.scrollTo({
      left: Math.max(0, position.x * scale - 40),
      top: Math.max(0, position.y * scale - 40),
      behavior: "smooth",
    });
    // Only jump when the search result changes; dragging a table should not
    // keep re-centering the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, firstMatch]);

  const fitToView = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const next = Math.max(
      0.3,
      Math.min(
        2.5,
        Math.min((element.clientWidth - 24) / Math.max(1, layout.width), (element.clientHeight - 24) / Math.max(1, layout.height))
      )
    );
    setScale(Number(next.toFixed(2)));
    requestAnimationFrame(() => element.scrollTo({ left: 0, top: 0, behavior: "smooth" }));
  }, [layout.width, layout.height]);

  const autoLayout = () => {
    setPositionsState({ key: positionsKey, positions: {} });
    try {
      localStorage.removeItem(positionsKey);
    } catch {
      /* ignore unavailable storage */
    }
  };

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

  const openAddColumn = (table: ErdTable) => {
    setColumnEdit({
      open: true,
      mode: "add",
      table: table.name,
      column: emptyColumn({ type: "varchar", length: "255" }),
      existingNames: table.columns.map((column) => column.name),
    });
  };

  const openEditColumn = (table: ErdTable, column: ErdColumn) => {
    if (isGeneratedColumn(column)) return;
    setColumnEdit({
      open: true,
      mode: "modify",
      table: table.name,
      column: toColumnDef(column),
      existingNames: table.columns.map((item) => item.name),
    });
  };

  const submitColumn = async (column: ColumnDefInput, after?: string) => {
    if (!columnEdit) return;
    if (columnEdit.mode === "add") {
      await api.addColumn(connectionId, database, columnEdit.table, column, after);
      toast.success(t("erd.columnAdded", "Field added"));
    } else {
      await api.modifyColumn(connectionId, database, columnEdit.table, columnEdit.column.name, column);
      toast.success(t("erd.columnUpdated", "Field updated"));
    }
    await load();
  };

  const resetView = () => {
    setScale(1);
    scrollRef.current?.scrollTo({ left: 0, top: 0 });
    setPositionsState({ key: positionsKey, positions: {} });
    try {
      localStorage.removeItem(positionsKey);
    } catch {
      /* ignore unavailable storage */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Share2 className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t("erd.title", "ER diagram")}</span>
        <span className="font-mono text-xs text-muted-foreground">{database}</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("erd.search", "Find table or field…")}
            aria-label={t("erd.search", "Find table or field…")}
            className="h-7 w-[190px] pl-7 text-xs"
          />
        </div>
        {data && (
          <>
            <Badge variant="secondary">
              {data.tables.length} {t("erd.tables", "tables")}
            </Badge>
            <Badge variant="secondary">
              {data.edges.length} {t("erd.relations", "relations")}
            </Badge>
            {unconnectedCount > 0 && (
              <Badge variant="outline" className="border-dashed">
                {unconnectedCount} {t("erd.unconnected", "unconnected")}
              </Badge>
            )}
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
          <Button
            size="icon-sm"
            variant="outline"
            title={t("erd.fit", "Fit to view")}
            onClick={fitToView}
          >
            <Maximize2 />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            title={t("erd.autoLayout", "Auto layout")}
            onClick={autoLayout}
          >
            <LayoutGrid />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={resetView}
            title={t("erd.resetHint", "Reset zoom, scroll and table positions")}
          >
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
        ) : !data || visibleTables.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("erd.empty", "No tables to show.")}
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
                const dimmed =
                  matchedTableNames !== null &&
                  !matchedTableNames.has(edge.fromTable) &&
                  !matchedTableNames.has(edge.toTable);
                return (
                  <g
                    key={`${edge.fromTable}-${edge.fromColumn}-${edge.toTable}-${edge.toColumn}-${edge.constraint}-${i}`}
                    opacity={dimmed ? 0.12 : 1}
                  >
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

              {visibleTables.map((table) => {
                const p = layout.positions.get(table.name);
                if (!p) return null;
                const unconnected = !connectedTables.has(table.name);
                const dimmed = matchedTableNames !== null && !matchedTableNames.has(table.name);
                const counts = tableCounts.get(table.name) ?? { fk: 0, inferred: 0 };
                const relationText = unconnected
                  ? t("erd.noLinks", "No relations")
                  : [
                      `${counts.fk} FK`,
                      counts.inferred ? `${counts.inferred} ${t("erd.inferredShort", "inferred")}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                const footerY = HEADER_H + Math.max(1, table.columns.length) * COLUMN_H;
                return (
                  <g
                    key={table.name}
                    data-erd-box
                    transform={`translate(${p.x},${p.y})`}
                    opacity={dimmed ? 0.25 : 1}
                    className="transition-opacity"
                  >
                    <rect
                      width={BOX_W}
                      height={p.height}
                      rx={8}
                      className={unconnected ? "fill-card stroke-muted-foreground/40" : "fill-card stroke-border"}
                      strokeWidth={1}
                      strokeDasharray={unconnected ? "5 3" : undefined}
                    />
                    <g
                      className={draggingTable === table.name ? "cursor-grabbing" : "cursor-move"}
                      onMouseDown={(event) => beginTableDrag(table, p, event)}
                    >
                      <title>{t("erd.dragTableHint", "Drag to move table")}</title>
                      <rect
                        width={BOX_W}
                        height={HEADER_H}
                        rx={8}
                        className={unconnected ? "fill-muted/40" : "fill-primary/15"}
                      />
                      <rect
                        y={HEADER_H - 8}
                        width={BOX_W}
                        height={8}
                        className={unconnected ? "fill-muted/40" : "fill-primary/15"}
                      />
                      <text x={10} y={20} className="fill-foreground text-[11px] font-medium">
                        {truncateName(table.name, 26)}
                      </text>
                      <g transform={`translate(${BOX_W - 18},${HEADER_H / 2 - 2})`} className="fill-muted-foreground/60">
                        <circle cx={0} cy={0} r={1} />
                        <circle cx={4} cy={0} r={1} />
                        <circle cx={8} cy={0} r={1} />
                        <circle cx={0} cy={4} r={1} />
                        <circle cx={4} cy={4} r={1} />
                        <circle cx={8} cy={4} r={1} />
                      </g>
                    </g>

                    {table.columns.map((column, index) => {
                      const rowY = HEADER_H + index * COLUMN_H;
                      const generated = isGeneratedColumn(column);
                      const key = column.key === "PRI" ? "PK" : column.key === "UNI" ? "UQ" : "";
                      return (
                        <g
                          key={column.name}
                          className={generated ? undefined : "cursor-pointer"}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditColumn(table, column);
                          }}
                        >
                          <title>
                            {`${column.name} · ${column.type}${column.nullable ? " NULL" : ""}${
                              column.default ? ` · default ${column.default}` : ""
                            }${generated ? " (generated)" : ""}${
                              column.comment ? `\n${column.comment}` : ""
                            }\n${generated ? "" : t("erd.editColumnHint", "Click to edit field")}`}
                          </title>
                          {index > 0 && (
                            <line
                              x1={0}
                              y1={rowY}
                              x2={BOX_W}
                              y2={rowY}
                              className="stroke-border/40"
                              strokeWidth={0.7}
                            />
                          )}
                          <rect
                            x={0}
                            y={rowY}
                            width={BOX_W}
                            height={COLUMN_H}
                            className={generated ? "fill-transparent" : "fill-transparent hover:fill-primary/10"}
                          />
                          {key && (
                            <text x={8} y={rowY + 14} className="fill-amber-400 text-[8px] font-semibold">
                              {key}
                            </text>
                          )}
                          <text
                            x={key ? 27 : 10}
                            y={rowY + 14}
                            className={generated ? "fill-muted-foreground/70 text-[10px]" : "fill-foreground text-[10px]"}
                          >
                            {truncateName(column.name, 19)}
                          </text>
                          <text
                            x={BOX_W - 8}
                            y={rowY + 14}
                            textAnchor="end"
                            className="fill-muted-foreground text-[9px]"
                          >
                            {truncateName(column.type, 16)}
                          </text>
                        </g>
                      );
                    })}

                    <line
                      x1={0}
                      y1={footerY}
                      x2={BOX_W}
                      y2={footerY}
                      className="stroke-border/50"
                      strokeWidth={0.7}
                    />
                    <text x={10} y={footerY + 18} className="fill-muted-foreground text-[9px]">
                      {relationText}
                    </text>
                    <g
                      transform={`translate(${BOX_W - 24},${footerY + 5})`}
                      className="cursor-pointer"
                      onClick={(event) => {
                        event.stopPropagation();
                        openAddColumn(table);
                      }}
                    >
                      <title>{t("erd.addColumn", "Add field")}</title>
                      <rect width={18} height={18} rx={4} className="fill-primary/15 stroke-primary/30" />
                      <path
                        d="M9 5v8M5 9h8"
                        className="stroke-primary"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>

      {columnEdit && (
        <ColumnDialog
          open={columnEdit.open}
          onOpenChange={(open) => setColumnEdit(open ? columnEdit : null)}
          mode={columnEdit.mode}
          column={columnEdit.column}
          existingNames={columnEdit.existingNames}
          tableName={columnEdit.table}
          onSubmit={submitColumn}
        />
      )}
    </div>
  );
}
