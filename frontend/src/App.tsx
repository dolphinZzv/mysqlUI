import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  Database,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Server,
  Sun,
  Table2,
  Terminal,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Connection } from "@/lib/types";
import { tableTabId, type TabDef } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { TableTab } from "@/components/TableTab";
import { QueryTab } from "@/components/QueryTab";

const THEME_KEY = "mysqlui.theme";

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

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem(THEME_KEY) as "dark" | "light") || "dark"
  );
  const [connections, setConnections] = useState<Connection[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tabs, setTabs] = useState<TabDef[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const refreshConnections = useCallback(async () => {
    try {
      const list = await api.listConnections();
      setConnections(list);
      return list;
    } catch (err) {
      toast.error("Failed to load connections", {
        description: err instanceof Error ? err.message : String(err),
      });
      return [] as Connection[];
    }
  }, []);

  useEffect(() => {
    void refreshConnections();
  }, [refreshConnections]);

  useEffect(() => {
    api
      .version()
      .then((v) => setAppVersion(v.version))
      .catch(() => {});
  }, []);

  const openTable = useCallback((connection: Connection, database: string, table: string) => {
    const id = tableTabId(connection.id, database, table);
    setTabs((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      const tab: TabDef = {
        id,
        kind: "table",
        connectionId: connection.id,
        connectionName: connection.name,
        database,
        table,
        title: table,
      };
      return [...prev, tab];
    });
    setActiveId(id);
  }, []);

  const openQuery = useCallback((connection: Connection, database = "") => {
    const tab = newQueryTab(connection, database);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, []);

  const handleNewQuery = useCallback(() => {
    if (connections.length === 0) {
      toast.info("Create a connection first");
      setEditing(null);
      setDialogOpen(true);
      return;
    }
    const activeTab = tabs.find((t) => t.id === activeId);
    const conn =
      connections.find((c) => c.id === activeTab?.connectionId) ?? connections[0];
    openQuery(conn, activeTab?.database ?? "");
  }, [connections, tabs, activeId, openQuery]);

  const closeTab = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeId === id) {
      const fallback = next[idx] ?? next[idx - 1] ?? next[next.length - 1];
      setActiveId(fallback ? fallback.id : null);
    }
  };

  const renameTab = (oldId: string, newName: string) => {
    const target = tabs.find((t) => t.id === oldId);
    if (!target || target.kind !== "table") return;
    const newId = tableTabId(target.connectionId, target.database, newName);
    setTabs((prev) =>
      prev.map((t) => (t.id === oldId ? { ...t, id: newId, table: newName, title: newName } : t))
    );
    setActiveId((prev) => (prev === oldId ? newId : prev));
  };

  const handleSaved = async (connection: Connection) => {
    await refreshConnections();
    // Update tab titles/existence for renamed connections.
    setTabs((prev) =>
      prev.map((t) =>
        t.connectionId === connection.id ? { ...t, connectionName: connection.name } : t
      )
    );
  };

  const handleDelete = async (connection: Connection) => {
    try {
      await api.deleteConnection(connection.id);
      toast.success(`Deleted "${connection.name}"`);
      setConnections((prev) => prev.filter((c) => c.id !== connection.id));
      const next = tabs.filter((t) => t.connectionId !== connection.id);
      setTabs(next);
      if (!next.some((t) => t.id === activeId)) {
        setActiveId(next.length ? next[next.length - 1].id : null);
      }
    } catch (err) {
      toast.error("Delete failed", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* top bar */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button
            size="icon-sm"
            variant="ghost"
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <div className="flex items-center gap-2 pl-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Database className="h-4 w-4" />
            </div>
            <div className="leading-none">
              <div className="text-sm font-semibold">MySQL UI</div>
              <div className="text-[10px] text-muted-foreground">database manager</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => handleNewQuery()}>
              <Terminal /> New query
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus /> New connection
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Toggle theme"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {sidebarOpen && (
            <Sidebar
              connections={connections}
              onOpenTable={openTable}
              onNewQuery={openQuery}
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
          )}

          <main className="flex min-w-0 flex-1 flex-col">
            {/* tab bar */}
            {tabs.length > 0 && (
              <div className="scrollbar-thin flex h-10 shrink-0 items-stretch overflow-x-auto border-b bg-muted/20">
                {tabs.map((tab) => {
                  const active = tab.id === activeId;
                  return (
                    <div
                      key={tab.id}
                      className={cn(
                        "group flex min-w-[140px] max-w-[240px] cursor-pointer items-center gap-2 border-r px-3 text-[13px] transition-colors",
                        active
                          ? "bg-background text-foreground"
                          : "text-muted-foreground hover:bg-accent/50"
                      )}
                      onClick={() => setActiveId(tab.id)}
                    >
                      {tab.kind === "table" ? (
                        <Table2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      ) : (
                        <Terminal className="h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
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

            {/* content */}
            <div className="relative min-h-0 flex-1">
              {tabs.length === 0 ? (
                <EmptyState onNewConnection={() => { setEditing(null); setDialogOpen(true); }} onNewQuery={handleNewQuery} hasConnections={connections.length > 0} />
              ) : (
                tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={cn("absolute inset-0", tab.id === activeId ? "block" : "hidden")}
                  >
                    {tab.kind === "table" ? (
                      <TableTab
                        tab={tab}
                        onRenamed={(newName) => renameTab(tab.id, newName)}
                        onDropped={() => closeTab(tab.id)}
                      />
                    ) : (
                      <QueryTab tab={tab} connections={connections} />
                    )}
                  </div>
                ))
              )}
            </div>
          </main>
        </div>

        {/* status bar */}
        <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Server className="h-3 w-3" /> {connections.length} connection
            {connections.length === 1 ? "" : "s"}
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

      <ConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connection={editing}
        onSaved={handleSaved}
      />

      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{ classNames: { toast: "font-sans" } }}
      />
    </TooltipProvider>
  );
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
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Database className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold">Browse and edit your MySQL data</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect to a server, explore schemas in the sidebar, edit rows inline, and run SQL queries.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button onClick={onNewConnection} variant={hasConnections ? "outline" : "default"}>
            <Plus /> New connection
          </Button>
          <Button onClick={onNewQuery} disabled={!hasConnections}>
            <Terminal /> New query
          </Button>
        </div>
      </div>
    </div>
  );
}
