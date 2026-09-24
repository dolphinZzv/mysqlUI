import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  Braces,
  ChevronRight,
  Copy,
  Database as DatabaseIcon,
  Download,
  Eye,
  GitCompare,
  Loader2,
  MoreVertical,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Share2,
  Table2,
  Terminal,
  Trash2,
  Unplug,
  Upload,
  Users,
} from "lucide-react";
import { api, databaseExportUrl, serverExportUrl, triggerDownload } from "@/lib/api";
import type { Connection, CreateTableRequest, DatabaseInfo, TableInfo } from "@/lib/types";
import type { GenericTabKind } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

interface Props {
  connections: Connection[];
  onOpenTable: (connection: Connection, database: string, table: string) => void;
  onNewQuery: (connection: Connection, database?: string) => void;
  onOpenGeneric: (kind: GenericTabKind, connection: Connection, database?: string) => void;
  onImport: (connection: Connection, database: string | null, table: string | null) => void;
  onBackup: (connection: Connection, database: string | null) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onNewConnection: () => void;
}

const dbKey = (connId: string, db: string) => `${connId}:${db}`;

export function Sidebar({
  connections,
  onOpenTable,
  onNewQuery,
  onOpenGeneric,
  onImport,
  onBackup,
  onEdit,
  onDelete,
  onNewConnection,
}: Props) {
  const [filter, setFilter] = useState("");
  const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set());
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [dbs, setDbs] = useState<Record<string, DatabaseInfo[]>>({});
  const [tables, setTables] = useState<Record<string, TableInfo[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);
  const [designer, setDesigner] = useState<{ open: boolean; connection: Connection | null; database: string }>({
    open: false,
    connection: null,
    database: "",
  });

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
    if (!q) return connections;
    return connections.filter((c) => c.name.toLowerCase().includes(q) || c.host.toLowerCase().includes(q));
  }, [connections, filter]);

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

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
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

        {filtered.map((conn) => {
          const isOpen = expandedConns.has(conn.id);
          const connDbs = dbs[conn.id] || [];
          const connError = errors[conn.id];
          const connLoading = loading.has(`db:${conn.id}`);
          return (
            <div key={conn.id} className="mb-0.5">
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
                    ) : (
                      <Server
                        className={cn(
                          "h-4 w-4 shrink-0",
                          conn.color ? "" : "text-primary"
                        )}
                        style={conn.color ? { color: conn.color } : undefined}
                      />
                    )}
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
                        <DropdownMenuItem onClick={() => onOpenGeneric("monitor", conn)}>
                          <Activity /> Monitor
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onOpenGeneric("users", conn)}>
                          <Users /> Users
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
                  <ContextMenuItem onClick={() => onOpenGeneric("monitor", conn)}>
                    <Activity /> Monitor
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onOpenGeneric("users", conn)}>
                    <Users /> Users
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
                              <ContextMenuSeparator />
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
    </div>
  );
}
