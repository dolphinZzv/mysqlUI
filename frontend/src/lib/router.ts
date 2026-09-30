import { useCallback, useEffect, useState } from "react";
import type { GenericTabKind } from "@/lib/tabs";

/**
 * A tiny History-API router. It keeps the active tab in the URL so a refresh,
 * a shared link or the browser back/forward buttons restore the same view.
 *
 * Routes:
 *   /                                                 welcome / empty
 *   /c/:connectionId/query                            query without a database
 *   /c/:connectionId/:kind                            monitor | users | erd | diff | routines | versions
 *   /c/:connectionId/db/:database/query               query for a database
 *   /c/:connectionId/db/:database/:kind               generic tab for a database
 *   /c/:connectionId/db/:database/table/:table        table browser
 */

export const GENERIC_KINDS: GenericTabKind[] = ["monitor", "users", "erd", "diff", "routines", "versions"];
const GENERIC_SET = new Set<string>(GENERIC_KINDS);

export type Route =
  | { kind: "welcome" }
  | { kind: "table"; connectionId: string; database: string; table: string }
  | { kind: "query"; connectionId: string; database: string }
  | { kind: "generic"; generic: GenericTabKind; connectionId: string; database: string };

const seg = (value: string) => encodeURIComponent(value);

export function buildPath(route: Route): string {
  switch (route.kind) {
    case "welcome":
      return "/";
    case "table":
      return `/c/${seg(route.connectionId)}/db/${seg(route.database)}/table/${seg(route.table)}`;
    case "query":
      return route.database
        ? `/c/${seg(route.connectionId)}/db/${seg(route.database)}/query`
        : `/c/${seg(route.connectionId)}/query`;
    case "generic":
      return route.database
        ? `/c/${seg(route.connectionId)}/db/${seg(route.database)}/${route.generic}`
        : `/c/${seg(route.connectionId)}/${route.generic}`;
  }
}

export function parseLocation(pathname: string): Route {
  const parts = pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

  if (parts[0] !== "c" || !parts[1]) return { kind: "welcome" };
  const connectionId = parts[1];

  if (parts[2] === "db" && parts[3]) {
    const database = parts[3];
    if (parts[4] === "table" && parts[5]) {
      return { kind: "table", connectionId, database, table: parts[5] };
    }
    if (parts[4] === "query") {
      return { kind: "query", connectionId, database };
    }
    if (parts[4] && GENERIC_SET.has(parts[4])) {
      return { kind: "generic", generic: parts[4] as GenericTabKind, connectionId, database };
    }
    return { kind: "welcome" };
  }

  if (parts[2] === "query") {
    return { kind: "query", connectionId, database: "" };
  }
  if (parts[2] && GENERIC_SET.has(parts[2])) {
    return { kind: "generic", generic: parts[2] as GenericTabKind, connectionId, database: "" };
  }
  return { kind: "welcome" };
}

export function sameRoute(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "welcome":
      return true;
    case "table":
      return (
        b.kind === "table" &&
        a.connectionId === b.connectionId &&
        a.database === b.database &&
        a.table === b.table
      );
    case "query":
      return b.kind === "query" && a.connectionId === b.connectionId && (a.database || "") === (b.database || "");
    case "generic":
      return (
        b.kind === "generic" &&
        a.generic === b.generic &&
        a.connectionId === b.connectionId &&
        (a.database || "") === (b.database || "")
      );
  }
}

export interface Router {
  route: Route;
  navigate: (next: Route, options?: { replace?: boolean }) => void;
}

export function useRouter(): Router {
  const [route, setRoute] = useState<Route>(() => parseLocation(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parseLocation(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: Route, options?: { replace?: boolean }) => {
    const path = buildPath(next);
    const current = window.location.pathname + window.location.search;
    if (path !== current) {
      if (options?.replace) window.history.replaceState(null, "", path);
      else window.history.pushState(null, "", path);
    }
    setRoute(next);
  }, []);

  return { route, navigate };
}
