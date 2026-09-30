export type ChartType = "bar" | "line" | "area" | "pie";
export type ChartAggregate = "none" | "count" | "sum" | "avg" | "min" | "max";
export type ChartSort = "none" | "asc" | "desc";

export interface ChartConfig {
  type: ChartType;
  x: string;
  y: string[];
  aggregate: ChartAggregate;
  sort: ChartSort;
  limit: number;
}

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  categories: string[];
  series: ChartSeries[];
}

export type RowRecord = Record<string, unknown>;

/** Palette backed by the theme's chart CSS variables. */
export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  type: "bar",
  x: "",
  y: [],
  aggregate: "count",
  sort: "none",
  limit: 20,
};

/** Converts a value to a number when possible. */
export function toNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Renders a value as a short, human friendly category label. */
export function formatCategory(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function aggregateValues(values: number[], aggregate: ChartAggregate): number {
  if (values.length === 0) return 0;
  switch (aggregate) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return values[values.length - 1] ?? 0;
  }
}

/**
 * Turns a list of rows plus a chart config into plot-ready categories and
 * series. `count` ignores the y fields; every other aggregate groups by x.
 */
export function buildChartData(rows: RowRecord[], config: ChartConfig): ChartData {
  const { x, y, aggregate, sort, limit } = config;

  let categories: string[] = [];
  let series: ChartSeries[] = [];

  if (aggregate === "none") {
    categories = rows.map((row) => formatCategory(x ? row[x] : undefined));
    series = y.map((field) => ({
      name: field,
      values: rows.map((row) => toNumeric(row[field]) ?? 0),
    }));
    if (series.length === 0 && rows.length > 0) {
      series = [{ name: "count", values: rows.map(() => 1) }];
    }
  } else {
    const groups = new Map<string, RowRecord[]>();
    const order: string[] = [];
    for (const row of rows) {
      const key = formatCategory(x ? row[x] : undefined);
      let bucket = groups.get(key);
      if (!bucket) {
        bucket = [];
        groups.set(key, bucket);
        order.push(key);
      }
      bucket.push(row);
    }
    categories = order;

    if (aggregate === "count" || y.length === 0) {
      series = [{ name: "count", values: categories.map((key) => groups.get(key)?.length ?? 0) }];
    } else {
      series = y.map((field) => ({
        name: field,
        values: categories.map((key) =>
          aggregateValues(
            (groups.get(key) ?? [])
              .map((row) => toNumeric(row[field]))
              .filter((n): n is number => n !== null),
            aggregate
          )
        ),
      }));
    }
  }

  if (sort !== "none" && series.length > 0) {
    const totals = categories.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
    const order = categories.map((_, i) => i);
    order.sort((a, b) => (sort === "asc" ? totals[a] - totals[b] : totals[b] - totals[a]));
    categories = order.map((i) => categories[i]);
    series = series.map((s) => ({ name: s.name, values: order.map((i) => s.values[i]) }));
  }

  const cap = Math.max(1, limit);
  if (categories.length > cap) {
    categories = categories.slice(0, cap);
    series = series.map((s) => ({ name: s.name, values: s.values.slice(0, cap) }));
  }

  return { categories, series };
}

/** Heuristics used to pick sensible defaults for a fresh result set. */
export function suggestChartConfig(rows: RowRecord[], columns: string[], previous?: ChartConfig | null): ChartConfig {
  const sample = rows.slice(0, 200);
  const distinct = new Map<string, number>();
  const numericRatio = new Map<string, number>();

  for (const column of columns) {
    const seen = new Set<string>();
    let numeric = 0;
    let present = 0;
    for (const row of sample) {
      const value = row[column];
      if (value === undefined) continue;
      present++;
      if (toNumeric(value) !== null) numeric++;
      if (seen.size < 1000) seen.add(formatCategory(value));
    }
    distinct.set(column, seen.size);
    numericRatio.set(column, present === 0 ? 0 : numeric / present);
  }

  const isNumericColumn = (column: string) => (numericRatio.get(column) ?? 0) >= 0.6;

  // Prefer a categorical (non-numeric, low cardinality) column for the x axis.
  let x = previous?.x && columns.includes(previous.x) ? previous.x : "";
  if (!x) {
    let best: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const column of columns) {
      if (isNumericColumn(column)) continue;
      const score = distinct.get(column) ?? Number.POSITIVE_INFINITY;
      if (score < bestScore) {
        best = column;
        bestScore = score;
      }
    }
    x = best ?? columns[0] ?? "";
  }

  const numericColumns = columns.filter(isNumericColumn);
  let y =
    previous?.y && previous.y.length > 0 && previous.y.every((field) => columns.includes(field))
      ? previous.y
      : numericColumns.slice(0, 2);

  let aggregate: ChartAggregate = previous?.aggregate ?? "sum";
  if (y.length === 0) {
    aggregate = "count";
    y = [];
  } else if (aggregate === "count") {
    aggregate = "sum";
  }

  return {
    type: previous?.type ?? "bar",
    x,
    y,
    aggregate,
    sort: previous?.sort ?? "none",
    limit: previous?.limit ?? 20,
  };
}

/** A "nice" axis scale with rounded tick values. */
export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range || 1));
  const fraction = (range || 1) / Math.pow(10, exponent);
  let nice: number;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else {
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exponent);
}

export function niceScale(min: number, max: number, tickCount = 5): Scale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    if (min === 0) max = 1;
    else {
      min = Math.min(0, min);
      max = Math.max(0, max);
    }
  }
  const range = niceNum(max - min || 1, false);
  const step = niceNum(range / Math.max(1, tickCount - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  if (ticks.length < 2) ticks.push(niceMax + step);
  return { min: niceMin, max: niceMax, ticks };
}

/** Compact number formatting for axis labels and tooltips. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}
