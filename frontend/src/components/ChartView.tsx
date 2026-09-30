import * as React from "react";
import { AreaChart as AreaIcon, BarChart3, LineChart, PieChart, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import {
  buildChartData,
  CHART_COLORS,
  formatNumber,
  niceScale,
  suggestChartConfig,
  toNumeric,
  type ChartAggregate,
  type ChartConfig,
  type ChartSort,
  type ChartType,
  type RowRecord,
} from "@/lib/chart";
import { cn } from "@/lib/utils";

interface ChartViewProps {
  rows: RowRecord[];
  columns: string[];
  /** Remember the chosen configuration under this key. */
  storageKey?: string;
  height?: number;
  className?: string;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: { name: string; value: string; color: string }[];
}

function useElementWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function configStorageKey(storageKey?: string) {
  return storageKey ? `mysqlui-chart:${storageKey}` : "";
}

function loadConfig(storageKey?: string): ChartConfig | null {
  const key = configStorageKey(storageKey);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChartConfig>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      type: (parsed.type as ChartType) ?? "bar",
      x: typeof parsed.x === "string" ? parsed.x : "",
      y: Array.isArray(parsed.y) ? parsed.y.filter((v): v is string => typeof v === "string") : [],
      aggregate: (parsed.aggregate as ChartAggregate) ?? "count",
      sort: (parsed.sort as ChartSort) ?? "none",
      limit: typeof parsed.limit === "number" ? parsed.limit : 20,
    };
  } catch {
    return null;
  }
}

const CHART_TYPES: { value: ChartType; labelKey: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "bar", labelKey: "chart.type.bar", label: "Bar", icon: BarChart3 },
  { value: "line", labelKey: "chart.type.line", label: "Line", icon: LineChart },
  { value: "area", labelKey: "chart.type.area", label: "Area", icon: AreaIcon },
  { value: "pie", labelKey: "chart.type.pie", label: "Pie", icon: PieChart },
];

export function ChartView({ rows, columns, storageKey, height = 360, className }: ChartViewProps) {
  const { t } = useI18n();
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [config, setConfig] = React.useState<ChartConfig>(
    () => loadConfig(storageKey) ?? suggestChartConfig(rows, columns)
  );
  const [tooltip, setTooltip] = React.useState<TooltipState | null>(null);
  const columnsKey = columns.join("|");

  // Re-detect when the result shape changes and the current config no longer fits.
  React.useEffect(() => {
    setConfig((previous) => {
      const validX = !previous.x || columns.includes(previous.x);
      const validY = previous.y.every((field) => columns.includes(field));
      if (validX && validY) return previous;
      return suggestChartConfig(rows, columns, previous);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey]);

  React.useEffect(() => {
    if (storageKey && config.x) {
      try {
        localStorage.setItem(configStorageKey(storageKey), JSON.stringify(config));
      } catch {
        /* storage may be unavailable */
      }
    }
  }, [config, storageKey]);

  const numericColumns = React.useMemo(
    () => columns.filter((column) => rows.some((row) => toNumeric(row[column]) !== null)),
    [columns, rows]
  );

  const data = React.useMemo(() => buildChartData(rows, config), [rows, config]);

  const update = (patch: Partial<ChartConfig>) => setConfig((prev) => ({ ...prev, ...patch }));

  const toggleY = (field: string) => {
    setConfig((prev) => ({
      ...prev,
      y: prev.y.includes(field) ? prev.y.filter((f) => f !== field) : [...prev.y, field],
    }));
  };

  const reset = () => {
    const suggested = suggestChartConfig(rows, columns);
    setConfig({ ...suggested, type: config.type });
  };

  const chartWidth = Math.max(width - 24, 320);
  const margin = { top: 16, right: 20, bottom: 80, left: 64 };
  const plotWidth = Math.max(40, chartWidth - margin.left - margin.right);
  const plotHeight = Math.max(60, height - margin.top - margin.bottom);

  const values = data.series.flatMap((s) => s.values);
  const dataMin = Math.min(0, ...(values.length ? values : [0]));
  const dataMax = Math.max(0, ...(values.length ? values : [1]));
  const scale = niceScale(dataMin, dataMax, 5);
  const yFor = (value: number) => margin.top + plotHeight - ((value - scale.min) / (scale.max - scale.min || 1)) * plotHeight;

  const hasData = data.categories.length > 0 && data.series.length > 0;

  const showTooltip = (
    event: React.MouseEvent,
    title: string,
    rowsIn: { name: string; value: number; display?: string; color?: string }[]
  ) => {
    const container = ref.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTooltip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      title,
      rows: rowsIn.map((row, index) => ({
        name: row.name,
        value: row.display ?? formatNumber(row.value),
        color: row.color ?? CHART_COLORS[index % CHART_COLORS.length],
      })),
    });
  };

  const hideTooltip = () => setTooltip(null);

  const renderAxes = () => (
    <g>
      {scale.ticks.map((tick) => {
        const y = yFor(tick);
        return (
          <g key={tick}>
            <line x1={margin.left} x2={margin.left + plotWidth} y1={y} y2={y} className="stroke-border" strokeDasharray="3 3" />
            <text x={margin.left - 8} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {formatNumber(tick)}
            </text>
          </g>
        );
      })}
      <line x1={margin.left} x2={margin.left + plotWidth} y1={yFor(0)} y2={yFor(0)} className="stroke-border" />
    </g>
  );

  const renderXLabels = () => {
    const band = plotWidth / Math.max(1, data.categories.length);
    const step = Math.max(1, Math.ceil((data.categories.length * 60) / plotWidth));
    return (
      <g>
        {data.categories.map((category, index) => {
          if (index % step !== 0) return null;
          const x = margin.left + (index + 0.5) * band;
          return (
            <text
              key={index}
              x={x}
              y={margin.top + plotHeight + 14}
              textAnchor="end"
              transform={`rotate(-35, ${x}, ${margin.top + plotHeight + 14})`}
              className="fill-muted-foreground text-[10px]"
            >
              {category.length > 14 ? `${category.slice(0, 13)}…` : category}
            </text>
          );
        })}
      </g>
    );
  };

  const renderBars = () => {
    const band = plotWidth / Math.max(1, data.categories.length);
    const count = data.series.length;
    const groupPad = band * 0.18;
    const groupWidth = Math.max(1, band - groupPad * 2);
    const barWidth = groupWidth / Math.max(1, count);
    const baseline = yFor(0);
    return (
      <g>
        {data.categories.map((category, ci) =>
          data.series.map((series, si) => {
            const value = series.values[ci] ?? 0;
            const x = margin.left + ci * band + groupPad + si * barWidth;
            const y = value >= 0 ? yFor(value) : baseline;
            const h = Math.max(0, Math.abs(yFor(value) - baseline));
            return (
              <rect
                key={`${ci}-${si}`}
                x={x}
                y={y}
                width={Math.max(1, barWidth - (count > 1 ? 1.5 : 2))}
                height={h}
                fill={CHART_COLORS[si % CHART_COLORS.length]}
                rx={2}
                className="transition-opacity hover:opacity-80"
                onMouseMove={(event) =>
                  showTooltip(
                    event,
                    category,
                    data.series.map((s) => ({ name: s.name, value: s.values[ci] ?? 0 }))
                  )
                }
                onMouseLeave={hideTooltip}
              />
            );
          })
        )}
      </g>
    );
  };

  const linePath = (vals: number[]) => {
    const band = plotWidth / Math.max(1, data.categories.length);
    return vals
      .map((value, index) => {
        const x = margin.left + (index + 0.5) * band;
        return `${index === 0 ? "M" : "L"}${x},${yFor(value)}`;
      })
      .join(" ");
  };

  const renderLines = (area: boolean) => {
    const band = plotWidth / Math.max(1, data.categories.length);
    const baseline = yFor(0);
    return (
      <g>
        {area
          ? data.series.map((series, si) => (
              <path
                key={`area-${si}`}
                d={`${linePath(series.values)} L${margin.left + data.categories.length * band},${baseline} L${margin.left},${baseline} Z`}
                fill={CHART_COLORS[si % CHART_COLORS.length]}
                opacity={0.18}
              />
            ))
          : null}
        {data.series.map((series, si) => (
          <path
            key={`line-${si}`}
            d={linePath(series.values)}
            fill="none"
            stroke={CHART_COLORS[si % CHART_COLORS.length]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {data.series.map((series, si) =>
          series.values.map((value, index) => (
            <circle
              key={`dot-${si}-${index}`}
              cx={margin.left + (index + 0.5) * band}
              cy={yFor(value)}
              r={3}
              fill={CHART_COLORS[si % CHART_COLORS.length]}
              onMouseMove={(event) =>
                showTooltip(
                  event,
                  data.categories[index],
                  data.series.map((s) => ({ name: s.name, value: s.values[index] ?? 0 }))
                )
              }
              onMouseLeave={hideTooltip}
            />
          ))
        )}
      </g>
    );
  };

  const renderPie = () => {
    const totals = data.categories.map((_, index) =>
      data.series.reduce((sum, series) => sum + Math.max(0, series.values[index] ?? 0), 0)
    );
    const total = totals.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    const cx = margin.left + plotWidth / 2;
    const cy = margin.top + plotHeight / 2;
    const radius = Math.max(20, Math.min(plotWidth, plotHeight) / 2 - 8);
    let angle = -Math.PI / 2;

    return (
      <g>
        {data.categories.map((category, index) => {
          const fraction = totals[index] / total;
          const start = angle;
          const end = angle + fraction * Math.PI * 2;
          angle = end;
          const large = end - start > Math.PI ? 1 : 0;
          const x1 = cx + radius * Math.cos(start);
          const y1 = cy + radius * Math.sin(start);
          const x2 = cx + radius * Math.cos(end);
          const y2 = cy + radius * Math.sin(end);
          const d = `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z`;
          return (
            <path
              key={index}
              d={d}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              stroke="hsl(var(--background))"
              strokeWidth={1}
              className="transition-opacity hover:opacity-80"
              onMouseMove={(event) => {
                const percent = total > 0 ? ((totals[index] / total) * 100).toFixed(1) : "0.0";
                showTooltip(event, category, [
                  {
                    name: t("chart.value", "Value"),
                    value: totals[index],
                    display: `${formatNumber(totals[index])} (${percent}%)`,
                    color: CHART_COLORS[index % CHART_COLORS.length],
                  },
                ]);
              }}
              onMouseLeave={hideTooltip}
            />
          );
        })}
      </g>
    );
  };

  const pieLegend = () => {
    const totals = data.categories.map((_, index) =>
      data.series.reduce((sum, series) => sum + Math.max(0, series.values[index] ?? 0), 0)
    );
    const total = totals.reduce((a, b) => a + b, 0) || 1;
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {data.categories.map((category, index) => (
          <span key={index} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            <span className="max-w-[12rem] truncate text-foreground" title={category}>
              {category}
            </span>
            <span>{((totals[index] / total) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b p-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.type", "Chart type")}</Label>
          <Select value={config.type} onValueChange={(value) => update({ type: value as ChartType })}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_TYPES.map(({ value, labelKey, label, icon: Icon }) => (
                <SelectItem key={value} value={value}>
                  <span className="flex items-center gap-2">
                    <Icon className="size-3.5" /> {t(labelKey, label)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.xAxis", "X axis")}</Label>
          <Select value={config.x || " "} onValueChange={(value) => update({ x: value.trim() })}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue placeholder={t("chart.pickField", "Pick a column")} />
            </SelectTrigger>
            <SelectContent>
              {columns.map((column) => (
                <SelectItem key={column} value={column || " "}>
                  {column}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.value", "Value")}</Label>
          <Select value={config.aggregate} onValueChange={(value) => update({ aggregate: value as ChartAggregate })}>
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="count">{t("chart.agg.count", "Count")}</SelectItem>
              <SelectItem value="sum">{t("chart.agg.sum", "Sum")}</SelectItem>
              <SelectItem value="avg">{t("chart.agg.avg", "Average")}</SelectItem>
              <SelectItem value="min">{t("chart.agg.min", "Min")}</SelectItem>
              <SelectItem value="max">{t("chart.agg.max", "Max")}</SelectItem>
              <SelectItem value="none">{t("chart.agg.none", "Raw")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.sort", "Sort")}</Label>
          <Select value={config.sort} onValueChange={(value) => update({ sort: value as ChartSort })}>
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("chart.sort.none", "None")}</SelectItem>
              <SelectItem value="desc">{t("chart.sort.desc", "Descending")}</SelectItem>
              <SelectItem value="asc">{t("chart.sort.asc", "Ascending")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.limit", "Limit")}</Label>
          <Input
            value={String(config.limit)}
            onChange={(event) => {
              const next = Number(event.target.value);
              update({ limit: Number.isFinite(next) && next > 0 ? Math.min(next, 500) : 20 });
            }}
            className="h-8 w-20 font-mono text-xs"
            inputMode="numeric"
          />
        </div>

        <Button variant="outline" size="sm" onClick={reset} title={t("chart.reset", "Reset")}>
          <RotateCcw /> {t("chart.reset", "Reset")}
        </Button>

        {config.aggregate !== "count" && numericColumns.length > 0 ? (
          <div className="grid w-full gap-1.5">
            <Label className="text-xs">{t("chart.fields", "Value fields")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {numericColumns.map((column) => {
                const active = config.y.includes(column);
                return (
                  <button
                    key={column}
                    type="button"
                    onClick={() => toggleY(column)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {column}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div ref={ref} className="scrollbar-thin relative min-h-0 flex-1 overflow-auto p-3">
        {!hasData ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {t("chart.empty", "Not enough data to draw a chart.")}
          </div>
        ) : (
          <>
            <svg width={chartWidth} height={height} className="block">
              {config.type !== "pie" ? (
                <>
                  {renderAxes()}
                  {renderXLabels()}
                </>
              ) : null}
              {config.type === "bar" ? renderBars() : null}
              {config.type === "line" ? renderLines(false) : null}
              {config.type === "area" ? renderLines(true) : null}
              {config.type === "pie" ? renderPie() : null}
            </svg>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {config.type === "pie"
                ? pieLegend()
                : data.series.map((series, index) => (
                    <span key={series.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className="inline-block size-2.5 rounded-sm"
                        style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                      />
                      <span className="max-w-[12rem] truncate text-foreground" title={series.name}>
                        {series.name}
                      </span>
                    </span>
                  ))}
            </div>
          </>
        )}

        {tooltip ? (
          <div
            className="pointer-events-none absolute z-20 min-w-[8rem] rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md"
            style={{
              left: Math.min(tooltip.x + 12, Math.max(0, chartWidth - 180)),
              top: Math.max(0, tooltip.y - 8),
            }}
          >
            <div className="mb-1 max-w-[16rem] truncate font-medium" title={tooltip.title}>
              {tooltip.title}
            </div>
            {tooltip.rows.map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full" style={{ background: row.color }} />
                  <span className="max-w-[9rem] truncate text-muted-foreground">{row.name}</span>
                </span>
                <span className="font-mono">{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
