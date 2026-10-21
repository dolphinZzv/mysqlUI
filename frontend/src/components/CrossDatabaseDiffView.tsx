import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Copy, Database, GitCompare, Loader2, Play, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { Connection, CrossDatabaseDiffResult, DatabaseInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  connections: Connection[];
  connectionId: string;
  database: string;
}

export function CrossDatabaseDiffView({ connections, connectionId, database }: Props) {
  const [sourceConnection, setSourceConnection] = useState(connectionId);
  const [targetConnection, setTargetConnection] = useState(connectionId);
  const [sourceDatabase, setSourceDatabase] = useState(database);
  const [targetDatabase, setTargetDatabase] = useState(database);
  const [sourceDbs, setSourceDbs] = useState<DatabaseInfo[]>([]);
  const [targetDbs, setTargetDbs] = useState<DatabaseInfo[]>([]);
  const [includeDrops, setIncludeDrops] = useState(false);
  const [result, setResult] = useState<CrossDatabaseDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sourceConnection) return;
    api.listDatabases(sourceConnection).then(setSourceDbs).catch(() => setSourceDbs([]));
  }, [sourceConnection]);
  useEffect(() => {
    if (!targetConnection) return;
    api.listDatabases(targetConnection).then(setTargetDbs).catch(() => setTargetDbs([]));
  }, [targetConnection]);

  const compare = async () => {
    if (!sourceConnection || !sourceDatabase || !targetConnection || !targetDatabase) {
      toast.error("Select source and target connection/database");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      setResult(await api.crossDatabaseDiff({
        sourceConnectionId: sourceConnection,
        sourceDatabase,
        targetConnectionId: targetConnection,
        targetDatabase,
        includeDrops,
      }));
    } catch (err) {
      toast.error("Database comparison failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  const changedDDLCount = useMemo(
    () => result?.tablesChanged.reduce((sum, table) => sum + (table.diff?.ddl.length ?? (table.createSql ? 1 : 0)), 0) ?? 0,
    [result]
  );

  const copySQL = () => {
    if (!result?.ddl.length) return;
    void navigator.clipboard.writeText(result.ddl.map((statement) => statement.replace(/;$/, "") + ";").join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const execute = async () => {
    if (!result?.ddl.length) return;
    if (!window.confirm(`Execute ${result.ddl.length} statement(s) on ${targetConnection} / ${targetDatabase}? This writes to the target database.`)) {
      return;
    }
    setLoading(true);
    try {
      for (const statement of result.ddl) {
        await api.executeDDL(targetConnection, targetDatabase, statement.replace(/;$/, ""));
      }
      toast.success(`Executed ${result.ddl.length} statement(s)`);
      await compare();
    } catch (err) {
      toast.error("Migration failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b px-3 py-2">
        <GitCompare className="mb-2 h-4 w-4 text-primary" />
        <DatabasePicker
          label="Source (reference)"
          connections={connections}
          databases={sourceDbs}
          connectionId={sourceConnection}
          database={sourceDatabase}
          onConnection={(id) => { setSourceConnection(id); setSourceDatabase(""); }}
          onDatabase={setSourceDatabase}
        />
        <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" />
        <DatabasePicker
          label="Target (to be changed)"
          connections={connections}
          databases={targetDbs}
          connectionId={targetConnection}
          database={targetDatabase}
          onConnection={(id) => { setTargetConnection(id); setTargetDatabase(""); }}
          onDatabase={setTargetDatabase}
        />
        <label className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={includeDrops} onCheckedChange={(checked) => setIncludeDrops(Boolean(checked))} />
          Drop extra target objects
        </label>
        <Button className="mb-0.5" size="sm" onClick={() => void compare()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <GitCompare />} Compare databases
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4">
        {!result ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">
            Compare whole databases across connections, review the ordered migration SQL, then execute explicitly.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">{result.source}</Badge>
              <ArrowRight className="h-3.5 w-3.5" />
              <Badge variant="outline" className="font-mono">{result.target}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Summary label="Source objects" value={result.sourceTables} />
              <Summary label="Target objects" value={result.targetTables} />
              <Summary label="Added" value={result.tablesAdded.length} tone="emerald" />
              <Summary label="Changed" value={result.tablesChanged.length} tone="amber" />
              <Summary label="Removed" value={result.tablesRemoved.length} tone="destructive" />
            </div>

            {result.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <div className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-3.5 w-3.5" /> Preflight warnings</div>
                {result.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
              </div>
            )}

            {result.tablesAdded.length === 0 && result.tablesChanged.length === 0 && result.tablesRemoved.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
                <Check className="h-4 w-4" /> Databases are identical.
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-3">
                <ObjectList title="Added in target" objects={result.tablesAdded} tone="emerald" />
                <ObjectList title="Only in target (removed)" objects={result.tablesRemoved} tone="destructive" />
                <div className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium text-amber-500">
                    Changed <Badge variant="secondary">{result.tablesChanged.length}</Badge>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-auto p-2 text-xs">
                    {result.tablesChanged.map((table) => (
                      <div key={table.table} className="rounded border px-2 py-1">
                        <span className="font-mono">{table.table}</span>
                        <span className="ml-2 text-muted-foreground">
                          {table.diff
                            ? `${table.diff.columnsAdded.length}+ ${table.diff.columnsRemoved.length}- ${table.diff.columnsChanged.length}~ ${table.diff.indexesAdded.length}idx`
                            : table.status}
                        </span>
                      </div>
                    ))}
                    {result.tablesChanged.length === 0 && <p className="py-4 text-center text-muted-foreground">None</p>}
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  Ordered migration SQL
                  <Badge variant="secondary">{result.ddl.length}</Badge>
                  <span className="text-[10px] font-normal text-muted-foreground">({changedDDLCount} table changes)</span>
                </h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copySQL} disabled={result.ddl.length === 0}>
                    {copied ? <Check className="text-emerald-500" /> : <Copy />} Copy SQL
                  </Button>
                  <Button size="sm" onClick={() => void execute()} disabled={loading || result.ddl.length === 0}>
                    {loading ? <Loader2 className="animate-spin" /> : <Play />} Execute on target
                  </Button>
                </div>
              </div>
              <pre className="scrollbar-thin max-h-80 overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-[11px] leading-relaxed">
                {result.ddl.length ? result.ddl.map((statement) => statement.replace(/;$/, "") + ";").join("\n") : "-- no changes"}
              </pre>
              {result.tablesRemoved.length > 0 && !includeDrops && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Extra target objects are reported but not dropped. Enable “Drop extra target objects” to include DROP statements.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DatabasePicker({
  label,
  connections,
  databases,
  connectionId,
  database,
  onConnection,
  onDatabase,
}: {
  label: string;
  connections: Connection[];
  databases: DatabaseInfo[];
  connectionId: string;
  database: string;
  onConnection: (id: string) => void;
  onDatabase: (name: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex gap-1.5">
        <Select value={connectionId} onValueChange={onConnection}>
          <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="connection" /></SelectTrigger>
          <SelectContent>
            {connections.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>{connection.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={database} onValueChange={onDatabase}>
          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="database" /></SelectTrigger>
          <SelectContent>
            {databases.filter((item) => !item.isSystem).map((item) => (
              <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" | "destructive" }) {
  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={tone === "emerald" ? "text-lg font-semibold text-emerald-500" : tone === "amber" ? "text-lg font-semibold text-amber-500" : tone === "destructive" ? "text-lg font-semibold text-destructive" : "text-lg font-semibold"}>
        {value}
      </div>
    </div>
  );
}

function ObjectList({ title, objects, tone }: { title: string; objects: { name: string; type: string }[]; tone: "emerald" | "destructive" }) {
  return (
    <div className="rounded-lg border">
      <div className={tone === "emerald" ? "flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium text-emerald-500" : "flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium text-destructive"}>
        {title} <Badge variant="secondary">{objects.length}</Badge>
      </div>
      <div className="max-h-56 space-y-1 overflow-auto p-2 text-xs">
        {objects.map((object) => (
          <div key={object.name} className="flex items-center gap-2 rounded border px-2 py-1">
            <span className="font-mono">{object.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{object.type}</span>
          </div>
        ))}
        {objects.length === 0 && <p className="py-4 text-center text-muted-foreground">None</p>}
      </div>
    </div>
  );
}
