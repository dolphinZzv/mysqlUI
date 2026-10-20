import { useEffect, useState } from "react";

export interface PinnedQuery {
  id: string;
  name: string;
  sql: string;
  connectionId: string;
  connectionName: string;
  database: string;
  createdAt: number;
}

const KEY = "mysqlui.pinnedQueries";
const EVENT = "mysqlui:pinnedQueriesChanged";
const MAX_PINNED = 50;

function isPinnedQuery(value: unknown): value is PinnedQuery {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.sql === "string" &&
    typeof v.connectionId === "string" &&
    typeof v.connectionName === "string" &&
    typeof v.database === "string" &&
    typeof v.createdAt === "number"
  );
}

export function loadPinnedQueries(): PinnedQuery[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPinnedQuery) : [];
  } catch {
    return [];
  }
}

function persist(list: PinnedQuery[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(EVENT));
}

function defaultName(sql: string): string {
  const line =
    sql
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("--") && !l.startsWith("#") && !l.startsWith("/*")) ?? "Query";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export function findPinnedQuery(
  list: PinnedQuery[],
  connectionId: string,
  database: string,
  sql: string,
): PinnedQuery | undefined {
  return list.find((p) => p.connectionId === connectionId && p.database === database && p.sql === sql);
}

export function pinQuery(input: {
  sql: string;
  connectionId: string;
  connectionName: string;
  database: string;
  name?: string;
}): PinnedQuery {
  const sql = input.sql.trim();
  const list = loadPinnedQueries();
  const existing = findPinnedQuery(list, input.connectionId, input.database, sql);
  if (existing) return existing;

  const item: PinnedQuery = {
    id: `pin:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    name: input.name?.trim() || defaultName(sql),
    sql,
    connectionId: input.connectionId,
    connectionName: input.connectionName,
    database: input.database,
    createdAt: Date.now(),
  };
  persist([item, ...list].slice(0, MAX_PINNED));
  return item;
}

export function unpinQuery(id: string) {
  persist(loadPinnedQueries().filter((p) => p.id !== id));
}

export function usePinnedQueries(): PinnedQuery[] {
  const [list, setList] = useState<PinnedQuery[]>(loadPinnedQueries);

  useEffect(() => {
    const sync = () => setList(loadPinnedQueries());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return list;
}
