import { useCallback, useEffect, useState } from "react";

export interface FavoriteObject {
  kind: "table" | "database";
  connectionId: string;
  connectionName: string;
  database: string;
  table?: string;
  addedAt: number;
}

const KEY = "mysqlui.favorites.objects";
const EVENT = "mysqlui:favorites-changed";

function load(): FavoriteObject[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as FavoriteObject[]) : [];
    return Array.isArray(parsed) ? parsed.filter((f) => f && f.connectionId && f.database) : [];
  } catch {
    return [];
  }
}

function persist(list: FavoriteObject[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
}

export function favoriteId(f: Pick<FavoriteObject, "kind" | "connectionId" | "database" | "table">): string {
  return `${f.kind}:${f.connectionId}:${f.database}:${f.table ?? ""}`;
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteObject[]>(load);
  useEffect(() => {
    const refresh = () => setFavorites(load());
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const isFavorite = useCallback(
    (f: Pick<FavoriteObject, "kind" | "connectionId" | "database" | "table">) => {
      const id = favoriteId(f);
      return favorites.some((x) => favoriteId(x) === id);
    },
    [favorites]
  );

  const toggle = useCallback((f: Omit<FavoriteObject, "addedAt">) => {
    const list = load();
    const id = favoriteId(f);
    const exists = list.some((x) => favoriteId(x) === id);
    persist(exists ? list.filter((x) => favoriteId(x) !== id) : [{ ...f, addedAt: Date.now() }, ...list]);
  }, []);

  const remove = useCallback((f: Pick<FavoriteObject, "kind" | "connectionId" | "database" | "table">) => {
    const id = favoriteId(f);
    persist(load().filter((x) => favoriteId(x) !== id));
  }, []);

  return { favorites, isFavorite, toggle, remove };
}
