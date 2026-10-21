export interface QueryHistoryItem {
  id: string;
  sql: string;
  connectionId?: string;
  connectionName?: string;
  database?: string;
  at: number;
}

const KEY = "mysqlui.queryHistory.v2";
const LEGACY_KEY = "mysqlui.queryHistory";

export function loadQueryHistory(): QueryHistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QueryHistoryItem[];
      return Array.isArray(parsed) ? parsed.filter((h) => h && typeof h.sql === "string") : [];
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as string[];
      if (Array.isArray(parsed)) {
        const migrated = parsed
          .filter((sql) => typeof sql === "string")
          .map((sql, i) => ({ id: `h:legacy:${i}`, sql, at: Date.now() - i * 1000 }));
        localStorage.setItem(KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function saveQueryHistory(items: QueryHistoryItem[]): void {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)));
}

export function pushQueryHistory(
  items: QueryHistoryItem[],
  item: Omit<QueryHistoryItem, "id" | "at">
): QueryHistoryItem[] {
  const next: QueryHistoryItem[] = [
    { ...item, id: `h:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, at: Date.now() },
    ...items.filter((h) => h.sql !== item.sql),
  ].slice(0, 200);
  saveQueryHistory(next);
  return next;
}

export function removeQueryHistory(items: QueryHistoryItem[], id: string): QueryHistoryItem[] {
  const next = items.filter((h) => h.id !== id);
  saveQueryHistory(next);
  return next;
}

export function clearQueryHistory(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY);
}
