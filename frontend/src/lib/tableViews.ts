import { useCallback, useEffect, useState } from "react";
import type { FilterCondition } from "@/lib/types";

export interface GridPrefsSnapshot {
  widths?: Record<string, number>;
  hidden?: string[];
  frozen?: string[];
}

export interface SavedTableView {
  id: string;
  name: string;
  connectionId: string;
  connectionName: string;
  database: string;
  table: string;
  orderBy: string;
  filters: FilterCondition[];
  quickFilters: Record<string, string>;
  pageSize: number;
  gridPrefs?: GridPrefsSnapshot;
  createdAt: number;
}

const KEY = "mysqlui.savedTableViews";
const EVENT = "mysqlui:savedTableViewsChanged";
export const gridPrefsStorageKey = (connectionId: string, database: string, table: string) =>
  `mysqlui.gridPrefs.${connectionId}:${database}:${table}`;

export function loadSavedTableViews(): SavedTableView[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedTableView[]) : [];
    return Array.isArray(parsed) ? parsed.filter((view) => view && view.id && view.name) : [];
  } catch {
    return [];
  }
}

function persist(views: SavedTableView[]) {
  localStorage.setItem(KEY, JSON.stringify(views));
  window.dispatchEvent(new Event(EVENT));
}

export function saveTableView(view: Omit<SavedTableView, "id" | "createdAt">): SavedTableView {
  const views = loadSavedTableViews();
  const existing = views.find(
    (item) =>
      item.name.toLowerCase() === view.name.toLowerCase() &&
      item.connectionId === view.connectionId &&
      item.database === view.database &&
      item.table === view.table
  );
  const next: SavedTableView = {
    ...view,
    id: existing?.id ?? `view:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  persist(existing ? views.map((item) => (item.id === existing.id ? next : item)) : [next, ...views]);
  return next;
}

export function deleteTableView(id: string): void {
  persist(loadSavedTableViews().filter((view) => view.id !== id));
}

export function readGridPrefs(connectionId: string, database: string, table: string): GridPrefsSnapshot | undefined {
  try {
    const raw = localStorage.getItem(gridPrefsStorageKey(connectionId, database, table));
    return raw ? (JSON.parse(raw) as GridPrefsSnapshot) : undefined;
  } catch {
    return undefined;
  }
}

export function writeGridPrefs(
  connectionId: string,
  database: string,
  table: string,
  prefs: GridPrefsSnapshot | undefined
): void {
  try {
    const key = gridPrefsStorageKey(connectionId, database, table);
    if (prefs) localStorage.setItem(key, JSON.stringify(prefs));
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function useSavedTableViews() {
  const [views, setViews] = useState<SavedTableView[]>(loadSavedTableViews);
  useEffect(() => {
    const refresh = () => setViews(loadSavedTableViews());
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const remove = useCallback((id: string) => deleteTableView(id), []);
  return { views, remove };
}
