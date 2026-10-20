import { useEffect, useState } from "react";

export interface RecentTable {
  id: string;
  connectionId: string;
  connectionName: string;
  database: string;
  table: string;
  openedAt: number;
}

const KEY = "mysqlui.recentTables";
const EVENT = "mysqlui:recentTablesChanged";

export function loadRecentTables(): RecentTable[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentTable[]).filter((x) => x && typeof x.table === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentTable(item: Omit<RecentTable, "id" | "openedAt">) {
  const id = `${item.connectionId}:${item.database}:${item.table}`;
  const next = [
    { ...item, id, openedAt: Date.now() },
    ...loadRecentTables().filter((x) => x.id !== id),
  ].slice(0, 12);
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useRecentTables(): RecentTable[] {
  const [list, setList] = useState<RecentTable[]>(loadRecentTables);
  useEffect(() => {
    const sync = () => setList(loadRecentTables());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return list;
}
