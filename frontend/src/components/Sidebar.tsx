import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  Bookmark,
  Braces,
  ChevronRight,
  Copy,
  CopyPlus,
  Database as DatabaseIcon,
  Download,
  Eye,
  FolderPlus,
  GitCompare,
  History,
  Loader2,
  MoreVertical,
  Network,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Server,
  Share2,
  Star,
  Table2,
  Terminal,
  Trash2,
  Unplug,
  Upload,
  Users,
  X,
} from "lucide-react";
import { api, databaseExportUrl, serverExportUrl, triggerDownload } from "@/lib/api";
import type { Connection, CreateTableRequest, DatabaseInfo, ServerInfo, TableInfo } from "@/lib/types";
import type { GenericTabKind } from "@/lib/tabs";
import { unpinQuery, usePinnedQueries } from "@/lib/pinnedQueries";
import { useRecentTables } from "@/lib/recentObjects";
import { useFavorites } from "@/lib/favorites";
import { useSavedTableViews } from "@/lib/tableViews";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HardDrive } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TableDesignerDialog } from "@/components/TableDesignerDialog";
import { CopyTableDialog } from "@/components/CopyTableDialog";
import { CreateDatabaseDialog } from "@/components/CreateDatabaseDialog";
import { ViewDialog } from "@/components/ViewDialog";
import { DbFlavorIcon } from "@/components/DbFlavorIcon";
import { StatsDialog } from "@/components/StatsDialog";

interface Props {
  connections: Connection[];
  width?: number;
  onOpenTable: (connection: Connection, database: string, table: string) => void;
  onNewQuery: (connection: Connection, database?: string, sql?: string) => void;
  onOpenGeneric: (kind: GenericTabKind, connection: Connection, database?: string) => void;
  onImport: (connection: Connection, database: string | null, table: string | null) => void;
  onBackup: (connection: Connection, database: string | null) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onNewConnection: () => void;
  onDatabaseDropped?: (connectionId: string, database: string) => void;
  onConnectionsChanged?: () => void;
}

const dbKey = (connId: string, db: string) => `${connId}:${db}`;

export function Sidebar({
  connections,
  width,
  onOpenTable,
  onNewQuery,
  onOpenGeneric,
  onImport,
  onBackup,
  onEdit,
  onDelete,
  onNewConnection,
  onDatabaseDropped,
  onConnectionsChanged,
}: Props) {
  const [filter, setFilter] = useState("");
  const pinnedQueries = usePinnedQueries();
  const recentTables = useRecentTables();
  const { favorites, isFavorite, toggle: toggleFavorite } = useFavorites();
  const { views: savedTableViews } = useSavedTableViews();
  const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set());
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [dbs, setDbs] = useState<Record<string, DatabaseInfo[]>>({});
  const [tables, setTables] = useState<Record<string, TableInfo[]>>({});
  const [serverInfo, setServerInfo] = useState<Record<string, ServerInfo>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);
  const [designer, setDesigner] = useState<{ open: boolean; connection: Connection | null; database: string }>({
    open: false,
    connection: null,
    database: "",
  });
  const [copyState, setCopyState] = useState<{
    open: boolean;
    connection: Connection | null;
    database: string;
    table: string;
  }>({ open: false, connection: null, database: "", table: "" });
  const [createDbState, setCreateDbState] = useState<{ open: boolean; connection: Connection | null }>({
    open: false,
    connection: null,
  });
  const [viewState, setViewState] = useState<{
    open: boolean;
    connection: Connection | null;
    database: string;
  }>({ open: false, connection: null, database: "" });
  const [pendingDropDb, setPendingDropDb] = useState<{ connection: Connection; database: string } | null>(null);
  const [statsTarget, setStatsTarget] = useState<{ connection: Connection; database: string } | null>(null);

  const markLoading = (key: string, on: boolean) =>
    setLoading((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const loadDatabases = useCallback(async (conn: Connection) => {
    markLoading(`db:${conn.id}`, true);
    setErrors((e) => ({ ...e, [conn.id]: "" }));
    try {
      const list = await api.listDatabases(conn.id);
      setDbs((prev) => ({ ...prev, [conn.id]: list }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrors((e) => ({ ...e, [conn.id]: message }));
      toast.error(`Could not load databases for "${conn.name}"`, { description: message });
    } finally {
      markLoading(`db:${conn.id}`, false);
    }
  }, []);

  const loadTables = useCallback(async (conn: Connection, db: string) => {
    const key = dbKey(conn.id, db);
    markLoading(`tbl:${key}`, true);
    setErrors((e) => ({ ...e, [key]: "" }));
    try {
      const list = await api.listTables(conn.id, db);
      setTables((prev) => ({ ...prev, [key]: list }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrors((e) => ({ ...e, [key]: message }));
      toast.error(`Could not load tables for "${db}"`, { description: message });
    } finally {
      markLoading(`tbl:${key}`, false);
    }
  }, []);

  const toggleConnection = (conn: Connection) => {
    setExpandedConns((prev) => {
      const next = new Set(prev);
      if (next.has(conn.id)) {
        next.delete(conn.id);
      } else {
        next.add(conn.id);
        if (!dbs[conn.id]) void loadDatabases(conn);
      }
      return next;
    });
  };

  const toggleDatabase = (conn: Connection, db: string) => {
    const key = dbKey(conn.id, db);
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (!tables[key]) void loadTables(conn, db);
      }
      return next;
    });
  };

  // Keep caches in sync when connections are removed/renamed.
  useEffect(() => {
    const ids = new Set(connections.map((c) => c.id));
    setDbs((prev) => {
      const next: Record<string, DatabaseInfo[]> = {};
      for (const id of Object.keys(prev)) if (ids.has(id)) next[id] = prev[id];
      return next;
    });
  }, [connections]);

  useEffect(() => {
    let cancelled = false;
    for (const conn of connections) {
      api.serverInfo(conn.id)
        .then((info) => {
          if (!cancelled) setServerInfo((prev) => ({ ...prev, [conn.id]: info }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [connections]);

  const refreshConnection = (conn: Connection) => {
    setDbs((prev) => {
      const next = { ...prev };
      delete next[conn.id];
      return next;
    });
    void loadDatabases(conn);
  };

  const refreshDatabase = (conn: Connection, db: string) => {
    const key = dbKey(conn.id, db);
    setTables((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    void loadTables(conn, db);
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? connections.filter((c) => c.name.toLowerCase().includes(q) || c.host.toLowerCase().includes(q))
      : connections;
    return [...list].sort((a, b) => {
      const ga = (a.group || "").toLowerCase();
      const gb = (b.group || "").toLowerCase();
      if (ga !== gb) {
        if (!ga) return 1;
        if (!gb) return -1;
        return ga.localeCompare(gb);
      }
      if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [connections, filter]);

  const toggleConnectionFavorite = async (conn: Connection) => {
    try {
      await api.setConnectionFavorite(conn.id, !conn.favorite);
      toast.success(conn.favorite ? "Removed from favorites" : "Added to favorites");
      onConnectionsChanged?.();
    } catch (err) {
      toast.error("Could not update favorite", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const visiblePins = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return pinnedQueries.filter((p) => {
      if (!connections.some((c) => c.id === p.connectionId)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sql.toLowerCase().includes(q) ||
        p.connectionName.toLowerCase().includes(q)
      );
    });
  }, [pinnedQueries, connections, filter]);

  const copy = (text: string, label = "Copied to clipboard") => {
    void navigator.clipboard.writeText(text).then(() => toast.success(label));
  };

  const openDesigner = (conn: Connection, database: string) => {
    setDesigner({ open: true, connection: conn, database });
  };

  const handleCreateTable = async (request: CreateTableRequest) => {
    if (!designer.connection) return;
    await api.createTable(designer.connection.id, designer.database, request);
    toast.success(`Table "${request.name}" created`);
    const key = dbKey(designer.connection.id, designer.database);
    setExpandedDbs((prev) => new Set(prev).add(key));
    await loadTables(designer.connection, designer.database);
  };

  const openCreateDatabase = (conn?: Connection) => {
    if (connections.length === 0) {
      toast.info("Create a connection first");
      return;
    }
    setCreateDbState({ open: true, connection: conn ?? connections[0] });
  };

  const handleDatabaseCreated = (conn: Connection) => {
    setExpandedConns((prev) => new Set(prev).add(conn.id));
    refreshConnection(conn);
  };

  return (
    <div
      className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      style={width ? { width } : undefined}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connections</span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            title="Refresh all"
            onClick={() => connections.forEach(refreshConnection)}
          >
            <RefreshCw />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="New database"
            onClick={() => openCreateDatabase()}
            disabled={connections.length === 0}
          >
            <FolderPlus />
          </Button>
          <Button size="icon-sm" variant="ghost" title="New connection" onClick={onNewConnection}>
            <Plus />
          </Button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter connections"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-1.5 pb-4">
        {connections.length === 0 && (
          <div className="mx-2 mt-4 rounded-lg border border-dashed border-sidebar-border p-4 text-center">
            <Server className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">No connections yet.</p>
            <Button size="sm" variant="outline" className="mt-3 w-full" onClick={onNewConnection}>
              <Plus /> Add connection
            </Button>
          </div>
        )}

        {savedTableViews.filter((view) => connections.some((c) => c.id === view.connectionId)).length > 0 && (
          <div className="mb-2 border-b border-sidebar-border pb-1.5">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Bookmark className="h-3 w-3" /> Data views
            </div>
            {savedTableViews
              .filter((view) => connections.some((c) => c.id === view.connectionId))
              .slice(0, 12)
              .map((view) => {
                const conn = connections.find((c) => c.id === view.connectionId);
                if (!conn) return null;
                return (
                  <div
                    key={view.id}
                    className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] hover:bg-sidebar-accent"
                    title={`${view.connectionName} / ${view.database}.${view.table}`}
                    onClick={() => {
                      onOpenTable(conn, view.database, view.table);
                      window.setTimeout(() => {
                        window.dispatchEvent(
                          new CustomEvent("mysqlui:applyTableView", {
                            detail: {
                              connectionId: view.connectionId,
                              database: view.database,
                              table: view.table,
                              viewId: view.id,
                            },
                          })
                        );
                      }, 80);
                    }}
                  >
                    <Bookmark className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                    <span className="truncate text-[10px] text-muted-foreground">{view.table}</span>
                  </div>
                );
              })}
          </div>
        )}

        {favorites.filter((f) => connections.some((c) => c.id === f.connectionId)).length > 0 && (
          <div className="mb-2 border-b border-sidebar-border pb-1.5">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Favorites
            </div>
            {favorites
              .filter((f) => connections.some((c) => c.id === f.connectionId))
              .map((f) => {
                const conn = connections.find((c) => c.id === f.connectionId);
                if (!conn) return null;
                return (
                  <div
                    key={`${f.kind}:${f.connectionId}:${f.database}:${f.table ?? ""}`}
                    className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] hover:bg-sidebar-accent"
                    title={`${f.connectionName} / ${f.database}${f.table ? `.${f.table}` : ""}`}
                    onClick={() => {
                      if (f.kind === "table" && f.table) onOpenTable(conn, f.database, f.table);
                      else toggleDatabase(conn, f.database);
                    }}
                  >
                    {f.kind === "table" ? (
                      <Table2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <DatabaseIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{f.table ?? f.database}</span>
                    <button
                      className="rounded p-0.5 opacity-0 transition-opacity hover:bg-background/60 group-hover:opacity-100"
                      title="Remove favorite"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(f);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
          </div>
        )}

        {recentTables.filter((r) => connections.some((c) => c.id === r.connectionId)).length > 0 && (
          <div className="mb-2 border-b border-sidebar-border pb-1.5">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <History className="h-3 w-3" /> Recent tables
            </div>
            {recentTables
              .filter((r) => connections.some((c) => c.id === r.connectionId))
              .slice(0, 8)
              .map((r) => {
                const conn = connections.find((c) => c.id === r.connectionId);
                if (!conn) return null;
                return (
                  <div
                    key={r.id}
                    className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] hover:bg-sidebar-accent"
                    title={`${r.connectionName} / ${r.database}.${r.table}`}
                    onClick={() => onOpenTable(conn, r.database, r.table)}
                  >
                    <Table2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span className="min-w-0 flex-1 truncate">{r.table}</span>
                    <span className="truncate text-[10px] text-muted-foreground">{r.database}</span>
                  </div>
                );
              })}
          </div>
        )}

        {visiblePins.length > 0 && (
          <div className="mb-2 border-b border-sidebar-border pb-1.5">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Pin className="h-3 w-3" /> Pinned queries
            </div>
            {visiblePins.map((p) => {
              const conn = connections.find((c) => c.id === p.connectionId);
              return (
                <ContextMenu key={p.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] hover:bg-sidebar-accent"
                      title={p.sql}
                      onClick={() => conn && onNewQuery(conn, p.database, p.sql)}
                    >
                      <Pin className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <button
                        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-background/60 group-hover:opacity-100"
                        title="Unpin"
                        onClick={(e) => {
                          e.stopPropagation();
                          unpinQuery(p.id);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => conn && onNewQuery(conn, p.database, p.sql)}>
                      <Terminal /> Open query
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => copy(p.sql, "SQL copied")}>
                      <Copy /> Copy SQL
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => unpinQuery(p.id)}
                    >
                      <PinOff /> Unpin
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        )}

        {filtered.map((conn, connIndex) => {
          const isOpen = expandedConns.has(conn.id);
          const group = (conn.group || "").trim();
          const previousGroup = connIndex > 0 ? (filtered[connIndex - 1].group || "").trim() : null;
          const showGroup = group !== previousGroup;
          const connDbs = dbs[conn.id] || [];
          const connError = errors[conn.id];
          const connLoading = loading.has(`db:${conn.id}`);
          return (
            <div key={conn.id} className="mb-0.5">
              {showGroup && (
                <div className="flex items-center gap-1 px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group || "Ungrouped"}
                </div>
              )}
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      "group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-sm hover:bg-sidebar-accent"
                    )}
                    onClick={() => toggleConnection(conn)}
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-90"
                      )}
                    />
                    {connError ? (
                      <Unplug className="h-4 w-4 shrink-0 text-destructive" />
                    ) : serverInfo[conn.id] ? (
                      <DbFlavorIcon
                        flavor={serverInfo[conn.id].flavor}
                        version={serverInfo[conn.id].version}
                        size={16}
                      />
                    ) : (
                      <Server
                        className={cn(
                          "h-4 w-4 shrink-0",
                          conn.color ? "" : "text-primary"
                        )}
                        style={conn.color ? { color: conn.color } : undefined}
                      />
                    )}
                    {conn.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{conn.name}</span>
                    {conn.ssh?.enabled && (
                      <Network
                        className="h-3 w-3 shrink-0 text-sky-400"
                        aria-label="via SSH tunnel"
                      />
                    )}
                    {connLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="rounded p-0.5 opacity-0 transition-opacity hover:bg-background/60 group-hover:opacity-100 data-[state=open]:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => onNewQuery(conn)}>
                          <Terminal /> New query
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openCreateDatabase(conn)}>
                          <FolderPlus /> New database
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onOpenGeneric("monitor", conn)}>
                          <Activity /> Monitor
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onOpenGeneric("users", conn)}>
                          <Users /> Users
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onOpenGeneric("crossdiff", conn)}>
                          <GitCompare /> Cross-connection diff
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onOpenGeneric("crossdbdiff", conn)}>
                          <GitCompare /> Whole-database diff
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => refreshConnection(conn)}>
                          <RefreshCw /> Refresh
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={async () => {
                            try {
                              const res = await api.testConnection(conn.id);
                              if (res.connected)
                                toast.success(`"${conn.name}" connected (${res.latencyMs ?? 0} ms)`);
                              else toast.error(`"${conn.name}" failed`, { description: res.error });
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : String(err));
                            }
                          }}
                        >
                          <Eye /> Test connection
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => void toggleConnectionFavorite(conn)}>
                          <Star className={cn(conn.favorite && "fill-amber-400 text-amber-400")} />
                          {conn.favorite ? "Remove from favorites" : "Add to favorites"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(conn)}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setPendingDelete(conn)}
                        >
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => onNewQuery(conn)}>
                    <Terminal /> New query
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => openCreateDatabase(conn)}>
                    <FolderPlus /> New database
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onOpenGeneric("monitor", conn)}>
                    <Activity /> Monitor
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onOpenGeneric("users", conn)}>
                    <Users /> Users
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onOpenGeneric("crossdiff", conn)}>
                    <GitCompare /> Cross-connection diff
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onOpenGeneric("crossdbdiff", conn)}>
                    <GitCompare /> Whole-database diff
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => refreshConnection(conn)}>
                    <RefreshCw /> Refresh
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => onBackup(conn, null)}>
                    <Download /> Backup server (SQL)
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onImport(conn, null, null)}>
                    <Upload /> Restore SQL
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => void toggleConnectionFavorite(conn)}>
                    <Star className={cn(conn.favorite && "fill-amber-400 text-amber-400")} />
                    {conn.favorite ? "Remove from favorites" : "Add to favorites"}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onEdit(conn)}>
                    <Pencil /> Edit
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setPendingDelete(conn)}
                  >
                    <Trash2 /> Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>

              {isOpen && (
                <div className="ml-2 border-l border-sidebar-border pl-1.5">
                  {connError && (
                    <div className="my-1 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-all">{connError}</span>
                    </div>
                  )}
                  {!connError && connDbs.length === 0 && !connLoading && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">No databases</p>
                  )}
                  {connDbs
                    .filter((d) => !filter || d.name.toLowerCase().includes(filter.toLowerCase()))
                    .map((db) => {
                      const key = dbKey(conn.id, db.name);
                      const isDbOpen = expandedDbs.has(key);
                      const dbTables = tables[key] || [];
                      const dbLoading = loading.has(`tbl:${key}`);
                      const dbError = errors[key];
                      return (
                        <div key={db.name} className="mb-0.5">
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <div
                                className="group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[13px] hover:bg-sidebar-accent"
                                onClick={() => toggleDatabase(conn, db.name)}
                              >
                                <ChevronRight
                                  className={cn(
                                    "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                                    isDbOpen && "rotate-90"
                                  )}
                                />
                                <DatabaseIcon
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0",
                                    db.isSystem ? "text-amber-500" : "text-sky-400"
                                  )}
                                />
                                <span className="min-w-0 flex-1 truncate">{db.name}</span>
                                <button
                                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-background/60 group-hover:opacity-100"
                                  title="New table"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDesigner(conn, db.name);
                                  }}
                                >
                                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                                {dbLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => openDesigner(conn, db.name)}>
                                <Plus /> New table
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onNewQuery(conn, db.name)}>
                                <Terminal /> New query
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => refreshDatabase(conn, db.name)}>
                                <RefreshCw /> Refresh tables
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => onOpenGeneric("routines", conn, db.name)}>
                                <Braces /> Routines / triggers
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onOpenGeneric("erd", conn, db.name)}>
                                <Share2 /> ER diagram
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onOpenGeneric("diff", conn, db.name)}>
                                <GitCompare /> Schema diff
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onOpenGeneric("versions", conn, db.name)}>
                                <History /> Schema versions
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => setStatsTarget({ connection: conn, database: db.name })}>
                                <HardDrive /> Capacity stats
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => {
                                  triggerDownload(databaseExportUrl(conn.id, db.name, "sql"));
                                  toast.success(`Exporting ${db.name}.sql`);
                                }}
                              >
                                <Download /> Backup (SQL)
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onImport(conn, db.name, null)}>
                                <Upload /> Import / restore SQL
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() =>
                                  setViewState({ open: true, connection: conn, database: db.name })
                                }
                              >
                                <Eye /> New view
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setPendingDropDb({ connection: conn, database: db.name })}
                              >
                                <Trash2 /> Drop database
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() =>
                                  toggleFavorite({
                                    kind: "database",
                                    connectionId: conn.id,
                                    connectionName: conn.name,
                                    database: db.name,
                                  })
                                }
                              >
                                <Star
                                  className={cn(
                                    isFavorite({
                                      kind: "database",
                                      connectionId: conn.id,
                                      database: db.name,
                                    }) && "fill-amber-400 text-amber-400"
                                  )}
                                />
                                {isFavorite({ kind: "database", connectionId: conn.id, database: db.name })
                                  ? "Remove from favorites"
                                  : "Add to favorites"}
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => copy(db.name, "Database name copied")}>
                                <Copy /> Copy name
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>

                          {isDbOpen && (
                            <div className="ml-3 border-l border-sidebar-border pl-1.5">
                              {dbError && (
                                <div className="my-1 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <span className="break-all">{dbError}</span>
                                </div>
                              )}
                              {!dbError && dbTables.length === 0 && !dbLoading && (
                                <p className="px-2 py-1 text-xs text-muted-foreground">No tables</p>
                              )}
                              {dbTables
                                .filter(
                                  (t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase())
                                )
                                .map((table) => (
                                  <ContextMenu key={table.name}>
                                    <ContextMenuTrigger asChild>
                                      <div
                                        className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] hover:bg-sidebar-accent"
                                        onClick={() => onOpenTable(conn, db.name, table.name)}
                                        title={table.comment || table.name}
                                      >
                                        <Table2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                        <span className="min-w-0 flex-1 truncate">{table.name}</span>
                                        {table.type === "VIEW" && (
                                          <Badge variant="warning" className="px-1 py-0 text-[10px]">
                                            view
                                          </Badge>
                                        )}
                                      </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                      <ContextMenuItem
                                        onClick={() => onOpenTable(conn, db.name, table.name)}
                                      >
                                        <Table2 /> Open table
                                      </ContextMenuItem>
                                      <ContextMenuItem onClick={() => onImport(conn, db.name, table.name)}>
                                        <Upload /> Import CSV
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onClick={() =>
                                          setCopyState({
                                            open: true,
                                            connection: conn,
                                            database: db.name,
                                            table: table.name,
                                          })
                                        }
                                      >
                                        <CopyPlus /> Copy table…
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onClick={() =>
                                          toggleFavorite({
                                            kind: "table",
                                            connectionId: conn.id,
                                            connectionName: conn.name,
                                            database: db.name,
                                            table: table.name,
                                          })
                                        }
                                      >
                                        <Star
                                          className={cn(
                                            isFavorite({
                                              kind: "table",
                                              connectionId: conn.id,
                                              database: db.name,
                                              table: table.name,
                                            }) && "fill-amber-400 text-amber-400"
                                          )}
                                        />
                                        {isFavorite({
                                          kind: "table",
                                          connectionId: conn.id,
                                          database: db.name,
                                          table: table.name,
                                        })
                                          ? "Remove from favorites"
                                          : "Add to favorites"}
                                      </ContextMenuItem>
                                      <ContextMenuItem onClick={() => copy(table.name, "Table name copied")}>
                                        <Copy /> Copy name
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onClick={() =>
                                          copy(
                                            `SELECT * FROM \`${db.name}\`.\`${table.name}\` LIMIT 100;`,
                                            "SELECT copied"
                                          )
                                        }
                                      >
                                        <Terminal /> Copy SELECT
                                      </ContextMenuItem>
                                    </ContextMenuContent>
                                  </ContextMenu>
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-sidebar-border px-3 py-2 text-[11px] text-muted-foreground">
        {connections.length} connection{connections.length === 1 ? "" : "s"}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connection?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.name}" will be removed from this tool. The MySQL server itself is not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TableDesignerDialog
        open={designer.open}
        onOpenChange={(o) => setDesigner((s) => ({ ...s, open: o }))}
        onSubmit={handleCreateTable}
      />

      <CreateDatabaseDialog
        open={createDbState.open}
        onOpenChange={(o) => setCreateDbState((s) => ({ ...s, open: o }))}
        connections={connections}
        initialConnectionId={createDbState.connection?.id}
        onCreated={handleDatabaseCreated}
      />

      {viewState.connection && (
        <ViewDialog
          open={viewState.open}
          onOpenChange={(o) => setViewState((s) => ({ ...s, open: o }))}
          connectionId={viewState.connection.id}
          database={viewState.database}
          onSaved={() => {
            if (viewState.connection) refreshDatabase(viewState.connection, viewState.database);
          }}
        />
      )}

      <AlertDialog open={!!pendingDropDb} onOpenChange={(o) => !o && setPendingDropDb(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop database?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-mono">{pendingDropDb?.database}</span> and all of its
              tables, views and data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const target = pendingDropDb;
                setPendingDropDb(null);
                if (!target) return;
                void api
                  .dropDatabase(target.connection.id, target.database)
                  .then(() => {
                    toast.success(`Dropped database ${target.database}`);
                    refreshConnection(target.connection);
                    onDatabaseDropped?.(target.connection.id, target.database);
                  })
                  .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
              }}
            >
              Drop database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {copyState.connection && (
        <CopyTableDialog
          open={copyState.open}
          onOpenChange={(o) => setCopyState((s) => ({ ...s, open: o }))}
          connectionId={copyState.connection.id}
          database={copyState.database}
          table={copyState.table}
          connections={connections}
          onDone={() => {
            if (copyState.connection) {
              const key = dbKey(copyState.connection.id, copyState.database);
              setExpandedDbs((prev) => new Set(prev).add(key));
              void loadTables(copyState.connection, copyState.database);
            }
          }}
        />
      )}
      <StatsDialog
        open={statsTarget !== null}
        onOpenChange={(open) => !open && setStatsTarget(null)}
        connectionId={statsTarget?.connection.id ?? ""}
        database={statsTarget?.database ?? ""}
      />
    </div>
  );
}
