import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Toaster, toast } from "sonner";
import {
  Database,
  Languages,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { TableTab } from "@/components/TableTab";
import { QueryTab } from "@/components/QueryTab";
import { MonitorTab } from "@/components/MonitorTab";
import { UsersTab } from "@/components/UsersTab";
import { ErdView } from "@/components/ErdView";
import { SchemaDiffView } from "@/components/SchemaDiffView";
import { RoutinesView } from "@/components/RoutinesView";
import { SchemaVersionsView } from "@/components/SchemaVersionsView";
import { ObjectSearch } from "@/components/ObjectSearch";
import { ImportDialog } from "@/components/ImportDialog";
import { LoginScreen } from "@/components/LoginScreen";
import { useRouter, sameRoute, type Route } from "@/lib/router";

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ---- tab helpers ----
  const openTable = useCallback((connection: Connection, database: string, table: string) => {
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
    if (activeId === id) {
      const fallback = next[idx] ?? next[idx - 1] ?? next[next.length - 1];
      setActiveId(fallback ? fallback.id : null);
    }
  };

  const renameTab = (oldId: string, newName: string) => {
    const target = tabs.find((x) => x.id === oldId);
    if (!target || target.kind !== "table") return;
    const newId = tableTabId(target.connectionId, target.database, newName);
    setTabs((prev) => prev.map((x) => (x.id === oldId ? { ...x, id: newId, table: newName, title: newName } : x)));
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
            <Button
              size="icon-sm"
              variant="ghost"
              title={t("app.language", "Language")}
              onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            >
              <Languages />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title={t("app.toggleTheme", "Toggle theme")}
              onClick={() => setTheme((v) => (v === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <Button size="icon-sm" variant="ghost" title={t("app.logout", "Sign out")} onClick={() => void handleLogout()}>
              <LogOut />
            </Button>
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
                    <div
                      key={tab.id}
                      className={cn(
                        "group flex min-w-[140px] max-w-[240px] cursor-pointer items-center gap-2 border-r px-3 text-[13px] transition-colors",
                        active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-accent/50"
                      )}
                      onClick={() => setActiveId(tab.id)}
                    >
                      <TabIcon kind={tab.kind} />
                      <span className="min-w-0 flex-1 truncate" title={tab.title}>
                        {tab.title}
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
