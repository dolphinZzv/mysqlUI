import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Toaster, toast } from "sonner";
import {
  Database,
  HardDriveDownload,
  Languages,
  LogOut,
  Moon,
  MoreVertical,
  PanelLeftClose,
  ServerCog,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Server,
  Sun,
  Table2,
  Terminal,
  X,
} from "lucide-react";
import { api, databaseExportUrl, serverExportUrl, triggerDownload } from "@/lib/api";
import type { Connection, ForeignKeyInfo } from "@/lib/types";
import { tableTabId, genericTabId, type GenericTabKind, type TabDef } from "@/lib/tabs";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Sidebar } from "@/components/Sidebar";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { TableTab } from "@/components/TableTab";
import { QueryTab } from "@/components/QueryTab";
import { MonitorTab } from "@/components/MonitorTab";
import { UsersTab } from "@/components/UsersTab";
import { ErdView } from "@/components/ErdView";
import { SchemaDiffView } from "@/components/SchemaDiffView";
import { CrossDiffView } from "@/components/CrossDiffView";
import { CrossDatabaseDiffView } from "@/components/CrossDatabaseDiffView";
import { RoutinesView } from "@/components/RoutinesView";
import { SchemaVersionsView } from "@/components/SchemaVersionsView";
import { ObjectSearch } from "@/components/ObjectSearch";
import { ImportDialog } from "@/components/ImportDialog";
import { LoginScreen } from "@/components/LoginScreen";
import { UpdateDialog } from "@/components/UpdateDialog";
import { BackupDialog } from "@/components/BackupDialog";
import { ConnectionsToolsDialog } from "@/components/ConnectionsToolsDialog";
import { CommandPalette, type PaletteAction } from "@/components/CommandPalette";
import { useRouter, sameRoute, type Route } from "@/lib/router";
import { readQueryDraft, deleteQueryDraft } from "@/lib/queryDrafts";
import { recordRecentTable } from "@/lib/recentObjects";

const THEME_KEY = "mysqlui.theme";
const TABS_KEY = "mysqlui.tabs";
const ACTIVE_KEY = "mysqlui.activeTab";
const SIDEBAR_KEY = "mysqlui.sidebarWidth";

function newQueryTab(connection: Connection, database = ""): TabDef {
  return {
    id: `query:${connection.id}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    kind: "query",
    connectionId: connection.id,
    connectionName: connection.name,
    database,
    title: database ? `${database} — query` : "Query",
  };
}

const GENERIC_TITLES: Record<GenericTabKind, string> = {
  monitor: "Monitor",
  users: "Users",
  erd: "ER diagram",
  diff: "Schema diff",
  crossdiff: "Cross-connection diff",
  crossdbdiff: "Database diff",
  routines: "Routines",
  versions: "Schema versions",
};

function routeFromTab(tab: TabDef): Route {
  if (tab.kind === "table") {
    return { kind: "table", connectionId: tab.connectionId, database: tab.database, table: tab.table };
  }
  if (tab.kind === "query") {
    return { kind: "query", connectionId: tab.connectionId, database: tab.database };
  }
  return { kind: "generic", generic: tab.kind, connectionId: tab.connectionId, database: tab.database };
}

function tabMatchesRoute(tab: TabDef, route: Route): boolean {
  if (route.kind === "welcome" || tab.connectionId !== route.connectionId) return false;
  if (route.kind === "table") {
    return tab.kind === "table" && tab.database === route.database && tab.table === route.table;
  }
  if (route.kind === "query") {
    return tab.kind === "query" && (tab.database || "") === (route.database || "");
  }
  return tab.kind === route.generic && (tab.database || "") === (route.database || "");
}

function tabFromRoute(route: Route, connection: Connection): TabDef {
  if (route.kind === "table") {
    return {
      id: tableTabId(connection.id, route.database, route.table),
      kind: "table",
      connectionId: connection.id,
      connectionName: connection.name,
      database: route.database,
      table: route.table,
      title: route.table,
    };
  }
  if (route.kind === "generic") {
    return {
      id: genericTabId(route.generic, connection.id, route.database),
      kind: route.generic,
      connectionId: connection.id,
      connectionName: connection.name,
      database: route.database,
      title: route.database ? `${route.database} — ${GENERIC_TITLES[route.generic]}` : GENERIC_TITLES[route.generic],
    };
  }
  return newQueryTab(connection, route.kind === "query" ? route.database : "");
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem(THEME_KEY) as "dark" | "light") || "dark"
  );
  const [auth, setAuth] = useState<"checking" | "login" | "ready">("checking");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_KEY));
    return stored >= 200 && stored <= 640 ? stored : 288;
  });
  const [tabs, setTabs] = useState<TabDef[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [connectionsToolsOpen, setConnectionsToolsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const shortcutActionsRef = useRef<{ newQuery: () => void; closeTab: (id: string) => void }>({
    newQuery: () => {},
    closeTab: () => {},
  });
  const [importState, setImportState] = useState<{
    open: boolean;
    connection: Connection | null;
    database: string | null;
    table: string | null;
  }>({ open: false, connection: null, database: null, table: null });
  const restored = useRef(false);

  // ---- URL routing -------------------------------------------------------
  // The active tab is mirrored in the URL so a refresh / shared link / browser
  // back-forward restores the exact view. The open-tab list still lives in
  // localStorage; the URL only pins which tab is active.
  const { route, navigate } = useRouter();
  const [restoredReady, setRestoredReady] = useState(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const didInitialSync = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const startSidebarResize = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const onMove = (move: MouseEvent) => {
        const next = Math.min(640, Math.max(200, startWidth + move.clientX - startX));
        setSidebarWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  // ---- auth ----
  const checkAuth = useCallback(async () => {
    try {
      const status = await api.authStatus();
      setAuth(status.required && !status.authenticated ? "login" : "ready");
    } catch {
      setAuth("ready");
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const handler = () => setAuth("login");
    window.addEventListener("mysqlui:unauthorized", handler);
    return () => window.removeEventListener("mysqlui:unauthorized", handler);
  }, []);

  const refreshConnections = useCallback(async () => {
    try {
      const list = await api.listConnections();
      setConnections(list);
      return list;
    } catch (err) {
      toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
      return [] as Connection[];
    }
  }, [t]);

  useEffect(() => {
    if (auth !== "ready") return;
    void refreshConnections();
    api.version().then((v) => setAppVersion(v.version)).catch(() => {});
  }, [auth, refreshConnections]);

  // ---- session persistence ----
  useEffect(() => {
    if (auth !== "ready" || restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(TABS_KEY);
      const active = localStorage.getItem(ACTIVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TabDef[];
        if (Array.isArray(parsed) && parsed.length) {
          setTabs(parsed);
          setActiveId(active && parsed.some((x) => x.id === active) ? active : parsed[0].id);
        }
      }
    } catch {
      /* ignore */
    }
    setRestoredReady(true);
  }, [auth]);

  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      /* ignore */
    }
  }, [tabs, activeId]);

  // Open (or activate) the tab named by the current URL. This runs after the
  // session has been restored from localStorage and the connections are known.
  useEffect(() => {
    if (auth !== "ready" || !restoredReady || route.kind === "welcome") return;
    // If the active tab already matches the URL, keep it (important when several
    // query tabs share the same connection/database route).
    const current = tabsRef.current.find((x) => x.id === activeIdRef.current);
    if (current && tabMatchesRoute(current, route)) return;
    const existing = tabsRef.current.find((x) => tabMatchesRoute(x, route));
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const connection = connections.find((c) => c.id === route.connectionId);
    if (!connection) return;
    const tab = tabFromRoute(route, connection);
    setTabs((prev) => (prev.some((x) => tabMatchesRoute(x, route)) ? prev : [...prev, tab]));
    setActiveId(tab.id);
  }, [route, connections, auth, restoredReady]);

  // Mirror the active tab back into the URL.
  useEffect(() => {
    if (!restoredReady) return;
    const replace = !didInitialSync.current;
    didInitialSync.current = true;
    const tab = tabs.find((x) => x.id === activeId);
    const desired: Route = tab ? routeFromTab(tab) : { kind: "welcome" };
    if (sameRoute(desired, route)) return;
    navigate(desired, { replace });
  }, [activeId, tabs, route, restoredReady, navigate]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (meta && key === "k" && !e.shiftKey) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (meta && e.shiftKey && key === "p") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (meta && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const current = tabsRef.current.findIndex((tab) => tab.id === activeIdRef.current);
        if (current < 0 || tabsRef.current.length === 0) return;
        const delta = e.key === "ArrowRight" ? 1 : -1;
        const next = (current + delta + tabsRef.current.length) % tabsRef.current.length;
        setActiveId(tabsRef.current[next].id);
        return;
      }
      if (meta && e.altKey && key === "w") {
        e.preventDefault();
        if (activeIdRef.current) shortcutActionsRef.current.closeTab(activeIdRef.current);
        return;
      }
      if (meta && e.altKey && key === "b") {
        e.preventDefault();
        setSidebarOpen((value) => !value);
        return;
      }
      if (meta && e.altKey && key === "n") {
        e.preventDefault();
        shortcutActionsRef.current.newQuery();
        return;
      }
      if (meta && e.altKey && key === "e") {
        e.preventDefault();
        window.dispatchEvent(new Event("mysqlui:focusEditor"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- tab helpers ----
  const openTable = useCallback((connection: Connection, database: string, table: string) => {
    recordRecentTable({ connectionId: connection.id, connectionName: connection.name, database, table });
    const id = tableTabId(connection.id, database, table);
    setTabs((prev) => {
      if (prev.some((x) => x.id === id)) return prev;
      return [
        ...prev,
        {
          id,
          kind: "table",
          connectionId: connection.id,
          connectionName: connection.name,
          database,
          table,
          title: table,
        },
      ];
    });
    setActiveId(id);
  }, []);

  const openQuery = useCallback((connection: Connection, database = "", sql?: string) => {
    const tab = newQueryTab(connection, database);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    if (sql) setTimeout(() => window.dispatchEvent(new CustomEvent("mysqlui:setSql", { detail: { id: tab.id, sql } })), 0);
  }, []);

  const openGeneric = useCallback((kind: GenericTabKind, connection: Connection, database = "") => {
    const id = genericTabId(kind, connection.id, database);
    setTabs((prev) => {
      if (prev.some((x) => x.id === id)) return prev;
      return [
        ...prev,
        {
          id,
          kind,
          connectionId: connection.id,
          connectionName: connection.name,
          database,
          title: database ? `${database} — ${GENERIC_TITLES[kind]}` : GENERIC_TITLES[kind],
        },
      ];
    });
    setActiveId(id);
  }, []);

  const jumpToRef = useCallback(
    (connectionId: string, fk: ForeignKeyInfo, value: unknown) => {
      const conn = connections.find((c) => c.id === connectionId);
      if (!conn) return;
      openTable(conn, fk.refDatabase, fk.refTable);
      const id = tableTabId(conn.id, fk.refDatabase, fk.refTable);
      setActiveId(id);
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("mysqlui:applyFilter", {
            detail: { table: fk.refTable, column: fk.refColumn, value },
          })
        );
      }, 60);
    },
    [connections, openTable]
  );

  const closeTab = (id: string) => {
    const idx = tabs.findIndex((x) => x.id === id);
    const next = tabs.filter((x) => x.id !== id);
    setTabs(next);
    deleteQueryDraft(id);
    if (activeId === id) {
      const fallback = next[idx] ?? next[idx - 1] ?? next[next.length - 1];
      setActiveId(fallback ? fallback.id : null);
    }
  };

  const closeTabs = (ids: string[]) => {
    const remove = new Set(ids);
    if (remove.size === 0) return;
    const next = tabs.filter((x) => !remove.has(x.id));
    for (const id of remove) deleteQueryDraft(id);
    setTabs(next);
    if (activeId && remove.has(activeId)) {
      setActiveId(next.length ? next[next.length - 1].id : null);
    }
  };

  const closeOtherTabs = (id: string) => {
    closeTabs(tabs.filter((x) => x.id !== id).map((x) => x.id));
    setActiveId(id);
  };

  const closeTabsToRight = (id: string) => {
    const index = tabs.findIndex((x) => x.id === id);
    if (index < 0) return;
    closeTabs(tabs.slice(index + 1).map((x) => x.id));
  };

  const renameTabLabel = (id: string) => {
    const tab = tabs.find((x) => x.id === id);
    if (!tab) return;
    const value = window.prompt("Tab name", tab.customTitle ?? tab.title);
    if (value === null) return;
    const name = value.trim();
    setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, customTitle: name || undefined } : x)));
  };

  const duplicateQueryTab = (id: string) => {
    const tab = tabs.find((x) => x.id === id);
    if (!tab || tab.kind !== "query") return;
    const draft = readQueryDraft(id);
    const newId = `query:${tab.connectionId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const copy: TabDef = {
      ...tab,
      id: newId,
      customTitle: undefined,
      title: `${tab.customTitle ?? tab.title} (copy)`,
      initialSql: draft?.sql ?? tab.initialSql ?? "",
      initialSelection: draft?.selection ?? tab.initialSelection,
    };
    const index = tabs.findIndex((x) => x.id === id);
    setTabs((prev) => [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)]);
    setActiveId(newId);
  };

  const reorderTabs = (fromId: string, toId: string) => {
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === fromId);
      const to = prev.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const renameTab = (oldId: string, newName: string) => {
    const target = tabs.find((x) => x.id === oldId);
    if (!target || target.kind !== "table") return;
    const newId = tableTabId(target.connectionId, target.database, newName);
    setTabs((prev) =>
      prev.map((x) =>
        x.id === oldId ? { ...x, id: newId, table: newName, title: newName, customTitle: undefined } : x
      )
    );
    setActiveId((prev) => (prev === oldId ? newId : prev));
  };

  const handleNewQuery = useCallback(() => {
    if (connections.length === 0) {
      toast.info(t("sidebar.newConnection", "Create a connection first"));
      setEditing(null);
      setDialogOpen(true);
      return;
    }
    const activeTab = tabs.find((x) => x.id === activeId);
    const conn = connections.find((c) => c.id === activeTab?.connectionId) ?? connections[0];
    openQuery(conn, activeTab?.database ?? "");
  }, [connections, tabs, activeId, openQuery, t]);

  shortcutActionsRef.current = { newQuery: handleNewQuery, closeTab };

  const handleDatabaseDropped = useCallback((connectionId: string, database: string) => {
    const next = tabsRef.current.filter((t) => !(t.connectionId === connectionId && t.database === database));
    setTabs(next);
    if (!next.some((t) => t.id === activeIdRef.current)) {
      setActiveId(next.length ? next[next.length - 1].id : null);
    }
  }, []);

  const handleDelete = async (connection: Connection) => {
    try {
      await api.deleteConnection(connection.id);
      toast.success(t("sidebar.delete", "Deleted"));
      setConnections((prev) => prev.filter((c) => c.id !== connection.id));
      const next = tabs.filter((x) => x.connectionId !== connection.id);
      setTabs(next);
      if (!next.some((x) => x.id === activeId)) setActiveId(next.length ? next[next.length - 1].id : null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setAuth("login");
    setTabs([]);
    setActiveId(null);
  };

  const activeTab = useMemo(() => tabs.find((x) => x.id === activeId) ?? null, [tabs, activeId]);

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [
      {
        id: "new-query",
        label: "New query",
        group: "General",
        shortcut: "Ctrl/⌘+Alt+N",
        run: handleNewQuery,
      },
      {
        id: "new-connection",
        label: "New connection",
        group: "General",
        run: () => {
          setEditing(null);
          setDialogOpen(true);
        },
      },
      {
        id: "global-search",
        label: "Search tables and columns",
        group: "General",
        shortcut: "Ctrl/⌘+K",
        run: () => setSearchOpen(true),
      },
      {
        id: "focus-editor",
        label: "Focus SQL editor",
        group: "General",
        shortcut: "Ctrl/⌘+Alt+E",
        run: () => window.dispatchEvent(new Event("mysqlui:focusEditor")),
      },
      {
        id: "toggle-sidebar",
        label: "Toggle sidebar",
        group: "Layout",
        shortcut: "Ctrl/⌘+Alt+B",
        run: () => setSidebarOpen((value) => !value),
      },
      {
        id: "refresh-connections",
        label: "Refresh connections",
        group: "General",
        run: () => void refreshConnections(),
      },
      {
        id: "backups",
        label: "Scheduled backups and files",
        group: "Tools",
        run: () => setBackupOpen(true),
      },
      {
        id: "connection-tools",
        label: "Connection tools (clone, test all, import/export)",
        group: "Tools",
        run: () => setConnectionsToolsOpen(true),
      },
      {
        id: "updates",
        label: "Check for updates",
        group: "Tools",
        run: () => setUpdateOpen(true),
      },
    ];
    for (const tab of tabs) {
      actions.push({
        id: `tab:${tab.id}`,
        label: `Switch to ${tab.customTitle ?? tab.title}`,
        group: "Open tabs",
        run: () => setActiveId(tab.id),
      });
    }
    for (const connection of connections) {
      actions.push(
        {
          id: `conn-query:${connection.id}`,
          label: `New query · ${connection.name}`,
          group: "Connections",
          keywords: connection.host,
          run: () => openQuery(connection),
        },
        {
          id: `conn-monitor:${connection.id}`,
          label: `Monitor · ${connection.name}`,
          group: "Connections",
          keywords: connection.host,
          run: () => openGeneric("monitor", connection),
        },
        {
          id: `conn-users:${connection.id}`,
          label: `Users and privileges · ${connection.name}`,
          group: "Connections",
          keywords: connection.host,
          run: () => openGeneric("users", connection),
        },
        {
          id: `conn-diff:${connection.id}`,
          label: `Cross-connection diff · ${connection.name}`,
          group: "Connections",
          keywords: connection.host,
          run: () => openGeneric("crossdiff", connection),
        },
        {
          id: `conn-db-diff:${connection.id}`,
          label: `Whole-database diff · ${connection.name}`,
          group: "Connections",
          keywords: connection.host,
          run: () => openGeneric("crossdbdiff", connection),
        }
      );
    }
    return actions;
  }, [tabs, connections, handleNewQuery, refreshConnections, openQuery, openGeneric]);

  if (auth === "checking") {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">…</div>;
  }
  if (auth === "login") {
    return (
      <>
        <LoginScreen onSuccess={() => setAuth("ready")} />
        <Toaster theme={theme} position="bottom-right" />
      </>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col bg-background text-foreground">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button
            size="icon-sm"
            variant="ghost"
            title={t("app.toggleSidebar", "Toggle sidebar")}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <div className="flex items-center gap-2 pl-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Database className="h-4 w-4" />
            </div>
            <div className="leading-none">
              <div className="text-sm font-semibold">{t("app.name", "MySQL UI")}</div>
              <div className="text-[10px] text-muted-foreground">{t("app.subtitle", "database manager")}</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSearchOpen(true)} title="Ctrl+K">
              <Search /> {t("app.search", "Search")}
            </Button>
            <Button size="sm" variant="outline" onClick={handleNewQuery}>
              <Terminal /> {t("app.newQuery", "New query")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus /> {t("app.newConnection", "New connection")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" title={t("app.more", "More")}>
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{t("app.preferences", "Preferences")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
                  <Languages />
                  {t("app.language", "Language")}
                  <span className="ml-auto text-xs text-muted-foreground">{lang === "zh" ? "中文" : "EN"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme((v) => (v === "dark" ? "light" : "dark"))}>
                  {theme === "dark" ? <Sun /> : <Moon />}
                  {theme === "dark" ? t("app.themeLight", "Light theme") : t("app.themeDark", "Dark theme")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUpdateOpen(true)}>
                  <RefreshCw /> {t("app.update", "Update")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBackupOpen(true)}>
                  <HardDriveDownload /> {t("app.backups", "Scheduled backups")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setConnectionsToolsOpen(true)}>
                  <ServerCog /> {t("app.connectionTools", "Connection tools")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => void handleLogout()}
                >
                  <LogOut /> {t("app.logout", "Sign out")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {sidebarOpen && (
            <>
              <Sidebar
                connections={connections}
                width={sidebarWidth}
                onOpenTable={openTable}
              onNewQuery={openQuery}
              onOpenGeneric={openGeneric}
              onImport={(conn, db, table) => setImportState({ open: true, connection: conn, database: db, table })}
              onBackup={(conn, db) => {
                triggerDownload(db ? databaseExportUrl(conn.id, db) : serverExportUrl(conn.id));
                toast.success(t("app.backup", "Backup started"));
              }}
              onEdit={(c) => {
                setEditing(c);
                setDialogOpen(true);
              }}
              onDelete={handleDelete}
              onNewConnection={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              onDatabaseDropped={handleDatabaseDropped}
              onConnectionsChanged={() => void refreshConnections()}
            />
              <div
                role="separator"
                aria-orientation="vertical"
                title={t("app.resizeSidebar", "Drag to resize, double-click to reset")}
                onMouseDown={startSidebarResize}
                onDoubleClick={() => setSidebarWidth(288)}
                className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40"
              />
            </>
          )}

          <main className="flex min-w-0 flex-1 flex-col">
            {tabs.length > 0 && (
              <div className="scrollbar-thin flex h-10 shrink-0 items-stretch overflow-x-auto border-b bg-muted/20">
                {tabs.map((tab) => {
                  const active = tab.id === activeId;
                  return (
                    <ContextMenu key={tab.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          draggable
                          onDragStart={() => setDragTabId(tab.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (dragTabId && dragTabId !== tab.id) reorderTabs(dragTabId, tab.id);
                            setDragTabId(null);
                          }}
                          onDragEnd={() => setDragTabId(null)}
                          onAuxClick={(e) => {
                            if (e.button === 1) {
                              e.preventDefault();
                              closeTab(tab.id);
                            }
                          }}
                          className={cn(
                            "group flex min-w-[140px] max-w-[240px] cursor-pointer items-center gap-2 border-r px-3 text-[13px] transition-colors",
                            active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-accent/50"
                          )}
                          onClick={() => setActiveId(tab.id)}
                        >
                          <TabIcon kind={tab.kind} />
                          <span className="min-w-0 flex-1 truncate" title={tab.customTitle ?? tab.title}>
                            {tab.customTitle ?? tab.title}
                          </span>
                          <button
                            className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              closeTab(tab.id);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => renameTabLabel(tab.id)}>Rename tab</ContextMenuItem>
                        {tab.kind === "query" && (
                          <ContextMenuItem onClick={() => duplicateQueryTab(tab.id)}>Duplicate tab</ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => closeTab(tab.id)}>Close</ContextMenuItem>
                        <ContextMenuItem disabled={tabs.length <= 1} onClick={() => closeOtherTabs(tab.id)}>
                          Close other tabs
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={tabs.findIndex((x) => x.id === tab.id) >= tabs.length - 1}
                          onClick={() => closeTabsToRight(tab.id)}
                        >
                          Close tabs to the right
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            )}

            <div className="relative min-h-0 flex-1">
              {tabs.length === 0 ? (
                <EmptyState
                  onNewConnection={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                  onNewQuery={handleNewQuery}
                  hasConnections={connections.length > 0}
                />
              ) : (
                tabs.map((tab) => (
                  <div key={tab.id} className={cn("absolute inset-0", tab.id === activeId ? "block" : "hidden")}>
                    {renderTab(tab, connections, renameTab, closeTab, jumpToRef)}
                  </div>
                ))
              )}
            </div>
          </main>
        </div>

        <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Server className="h-3 w-3" /> {connections.length} {t("app.connections", "connections")}
          </span>
          {activeTab && (
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground/60">|</span>
              {activeTab.connectionName}
              {activeTab.database ? ` / ${activeTab.database}` : ""}
            </span>
          )}
          <span className="ml-auto">MySQL UI{appVersion ? ` ${appVersion}` : ""}</span>
        </footer>
      </div>

      <ConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} connection={editing} onSaved={refreshConnections} />
      <UpdateDialog open={updateOpen} onOpenChange={setUpdateOpen} />
      <BackupDialog open={backupOpen} onOpenChange={setBackupOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={paletteActions} />

      <ConnectionsToolsDialog
        open={connectionsToolsOpen}
        onOpenChange={setConnectionsToolsOpen}
        connections={connections}
        onChanged={() => void refreshConnections()}
      />

      <ObjectSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        connections={connections}
        activeConnectionId={activeTab?.connectionId}
        onOpenTable={openTable}
      />

      {importState.connection && (
        <ImportDialog
          open={importState.open}
          onOpenChange={(o) => setImportState((s) => ({ ...s, open: o }))}
          connectionId={importState.connection.id}
          connectionName={importState.connection.name}
          database={importState.database}
          table={importState.table}
        />
      )}

      <Toaster theme={theme} position="bottom-right" />
    </TooltipProvider>
  );
}

function TabIcon({ kind }: { kind: TabDef["kind"] }) {
  if (kind === "table") return <Table2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  if (kind === "query") return <Terminal className="h-3.5 w-3.5 shrink-0 text-primary" />;
  return <Database className="h-3.5 w-3.5 shrink-0 text-sky-400" />;
}

function renderTab(
  tab: TabDef,
  connections: Connection[],
  renameTab: (id: string, name: string) => void,
  onDropped: (id: string) => void,
  onJumpRef: (connectionId: string, fk: ForeignKeyInfo, value: unknown) => void
) {
  switch (tab.kind) {
    case "table":
      return (
        <TableTab
          tab={tab}
          onRenamed={(n) => renameTab(tab.id, n)}
          onDropped={() => onDropped(tab.id)}
          onOpenRef={(fk, value) => onJumpRef(tab.connectionId, fk, value)}
        />
      );
    case "query":
      return <QueryTab tab={tab} connections={connections} />;
    case "monitor":
      return <MonitorTab connectionId={tab.connectionId} />;
    case "users":
      return <UsersTab connectionId={tab.connectionId} />;
    case "erd":
      return <ErdView connectionId={tab.connectionId} database={tab.database} />;
    case "diff":
      return <SchemaDiffView connectionId={tab.connectionId} database={tab.database} />;
    case "crossdiff":
      return <CrossDiffView connections={connections} connectionId={tab.connectionId} database={tab.database} />;
    case "crossdbdiff":
      return <CrossDatabaseDiffView connections={connections} connectionId={tab.connectionId} database={tab.database} />;
    case "routines":
      return <RoutinesView connectionId={tab.connectionId} database={tab.database} />;
    case "versions":
      return <SchemaVersionsView connectionId={tab.connectionId} database={tab.database} />;
    default:
      return null;
  }
}

function EmptyState({
  onNewConnection,
  onNewQuery,
  hasConnections,
}: {
  onNewConnection: () => void;
  onNewQuery: () => void;
  hasConnections: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Database className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold">{t("app.name", "MySQL UI")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("app.subtitle", "Browse, edit and query your MySQL databases.")}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button onClick={onNewConnection} variant={hasConnections ? "outline" : "default"}>
            <Plus /> {t("app.newConnection", "New connection")}
          </Button>
          <Button onClick={onNewQuery} disabled={!hasConnections}>
            <Terminal /> {t("app.newQuery", "New query")}
          </Button>
        </div>
      </div>
    </div>
  );
}
