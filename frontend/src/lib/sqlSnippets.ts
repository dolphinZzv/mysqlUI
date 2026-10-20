import { useEffect, useState } from "react";

export interface SqlSnippet {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
}

const KEY = "mysqlui.sqlSnippets";
const EVENT = "mysqlui:sqlSnippetsChanged";

export function loadSqlSnippets(): SqlSnippet[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SqlSnippet => {
      if (!item || typeof item !== "object") return false;
      const v = item as Record<string, unknown>;
      return typeof v.id === "string" && typeof v.name === "string" && typeof v.sql === "string" && typeof v.createdAt === "number";
    });
  } catch {
    return [];
  }
}

function persist(list: SqlSnippet[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function addSqlSnippet(name: string, sql: string): SqlSnippet {
  const item: SqlSnippet = {
    id: `snippet:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || "Snippet",
    sql,
    createdAt: Date.now(),
  };
  persist([item, ...loadSqlSnippets()].slice(0, 100));
  return item;
}

export function updateSqlSnippet(id: string, name: string, sql: string) {
  persist(loadSqlSnippets().map((s) => (s.id === id ? { ...s, name: name.trim() || s.name, sql } : s)));
}

export function removeSqlSnippet(id: string) {
  persist(loadSqlSnippets().filter((s) => s.id !== id));
}

export function useSqlSnippets(): SqlSnippet[] {
  const [list, setList] = useState<SqlSnippet[]>(loadSqlSnippets);
  useEffect(() => {
    const sync = () => setList(loadSqlSnippets());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return list;
}

export function insertSqlText(text: string) {
  window.dispatchEvent(new CustomEvent("mysqlui:insertSql", { detail: { text } }));
}
