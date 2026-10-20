import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Copy, GitCompare, Loader2, Play } from "lucide-react";
import { api } from "@/lib/api";
import type { Connection, CrossDiffResult, DatabaseInfo, TableInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  connections: Connection[];
  connectionId: string;
  database: string;
}

interface Picker {
  connectionId: string;
  database: string;
  table: string;
}

export function CrossDiffView({ connections, connectionId, database }: Props) {
  const [mode, setMode] = useState<"schema" | "data" | "both">("schema");
  const [source, setSource] = useState<Picker>({ connectionId, database, table: "" });
  const [target, setTarget] = useState<Picker>({ connectionId, database, table: "" });
  const [sourceDbs, setSourceDbs] = useState<DatabaseInfo[]>([]);
  const [targetDbs, setTargetDbs] = useState<DatabaseInfo[]>([]);
  const [sourceTables, setSourceTables] = useState<TableInfo[]>([]);
  const [targetTables, setTargetTables] = useState<TableInfo[]>([]);
  const [result, setResult] = useState<CrossDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!source.connectionId) return;
    api.listDatabases(source.connectionId).then(setSourceDbs).catch(() => setSourceDbs([]));
  }, [source.connectionId]);

  useEffect(() => {
    if (!target.connectionId) return;
    api.listDatabases(target.connectionId).then(setTargetDbs).catch(() => setTargetDbs([]));
  }, [target.connectionId]);

  useEffect(() => {
    if (!source.connectionId || !source.database) {
      setSourceTables([]);
      return;
    }
    api.listTables(source.connectionId, source.database).then(setSourceTables).catch(() => setSourceTables([]));
  }, [source.connectionId, source.database]);

  useEffect(() => {
    if (!target.connectionId || !target.database) {
      setTargetTables([]);
      return;
    }
    api.listTables(target.connectionId, target.database).then(setTargetTables).catch(() => setTargetTables([]));
  }, [target.connectionId, target.database]);

  const compare = async () => {
    if (!source.connectionId || !source.database || !source.table || !target.connectionId || !target.database || !target.table) {
      toast.error("Select source and target connection/database/table");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      setResult(
        await api.crossDiff({
          sourceConnectionId: source.connectionId,
          sourceDatabase: source.database,
          sourceTable: source.table,
          targetConnectionId: target.connectionId,
          targetDatabase: target.database,
          targetTable: target.table,
          mode,
        })
      );
    } catch (err) {
      toast.error("Comparison failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  const allSQL = useMemo(() => {
    if (!result) return [] as string[];
    const stmts = [...(result.schema?.ddl ?? [])];
    if (result.data?.sql) stmts.push(...result.data.sql.split("\n").filter(Boolean));
    return stmts;
  }, [result]);

  const copySQL = () => {
    if (!allSQL.length) return;
    void navigator.clipboard.writeText(allSQL.join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const execute = async () => {
    if (!allSQL.length || !target.connectionId) return;
    if (!window.confirm(`Execute ${allSQL.length} statement(s) on ${target.connectionId}? This writes to the target.`)) return;
    setLoading(true);
    try {
      for (const stmt of allSQL) {
        await api.executeDDL(target.connectionId, target.database, stmt.replace(/;$/, ""));
      }
      toast.success(`Executed ${allSQL.length} statement(s)`);
      await compare();
    } catch (err) {
      toast.error("Execution failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  const noDiff =
    result &&
    (!result.schema ||
      (result.schema.columnsAdded.length === 0 &&
        result.schema.columnsRemoved.length === 0 &&
        result.schema.columnsChanged.length === 0 &&
        result.schema.indexesAdded.length === 0 &&
        result.schema.indexesRemoved.length === 0)) &&
    (!result.data || result.data.sql.length === 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b px-3 py-2">
        <GitCompare className="mb-2 h-4 w-4 text-primary" />
        <PickerGroup
          label="Source (reference)"
          connections={connections}
          databases={sourceDbs}
          tables={sourceTables}
          value={source}
          onChange={setSource}
        />
        <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" />
        <PickerGroup
          label="Target (to be changed)"
          connections={connections}
          databases={targetDbs}
          tables={targetTables}
          value={target}
          onChange={setTarget}
        />
        <div className="mb-0.5 grid gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Compare</span>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "schema" | "data" | "both")}>
            <TabsList className="h-8">
              <TabsTrigger value="schema" className="px-2 text-xs">Schema</TabsTrigger>
              <TabsTrigger value="data" className="px-2 text-xs">Data</TabsTrigger>
              <TabsTrigger value="both" className="px-2 text-xs">Both</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Button className="mb-0.5" size="sm" onClick={() => void compare()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <GitCompare />} Compare
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4">
        {!result ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">
            Cross-connection diff — choose a source and target table. No writes are performed until you explicitly execute.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">{result.source}</Badge>
              <ArrowRight className="h-3.5 w-3.5" />
              <Badge variant="outline" className="font-mono">{result.target}</Badge>
            </div>
            {noDiff && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
                <Check className="h-4 w-4" /> Identical, no differences
              </div>
            )}
            {result.schema && (
              <>
                {result.schema.columnsAdded.length > 0 && (
                  <DiffSection title="Columns added" count={result.schema.columnsAdded.length} tone="emerald">
                    {result.schema.columnsAdded.map((c) => (
                      <div key={c.name} className="font-mono text-[12px]">
                        + {c.name} <span className="text-muted-foreground">{c.columnType}</span>
                      </div>
                    ))}
                  </DiffSection>
                )}
                {result.schema.columnsRemoved.length > 0 && (
                  <DiffSection title="Columns removed" count={result.schema.columnsRemoved.length} tone="destructive">
                    {result.schema.columnsRemoved.map((c) => (
                      <div key={c.name} className="font-mono text-[12px]">
                        − {c.name} <span className="text-muted-foreground">{c.columnType}</span>
                      </div>
                    ))}
                  </DiffSection>
                )}
                {result.schema.columnsChanged.length > 0 && (
                  <DiffSection title="Columns changed" count={result.schema.columnsChanged.length} tone="amber">
                    {result.schema.columnsChanged.map((c) => (
                      <div key={c.name} className="font-mono text-[12px]">
                        ~ {c.name}: <span className="text-muted-foreground">{c.target.columnType}</span> →{" "}
                        <span className="text-foreground">{c.source.columnType}</span>
                      </div>
                    ))}
                  </DiffSection>
                )}
                {result.schema.indexesAdded.length > 0 && (
                  <DiffSection title="Indexes added" count={result.schema.indexesAdded.length} tone="emerald">
                    {result.schema.indexesAdded.map((i) => (
                      <div key={i.name} className="font-mono text-[12px]">
                        + {i.name} ({i.columns.join(", ")}){i.unique ? " UNIQUE" : ""}
                      </div>
                    ))}
                  </DiffSection>
                )}
                {result.schema.indexesRemoved.length > 0 && (
                  <DiffSection title="Indexes removed" count={result.schema.indexesRemoved.length} tone="destructive">
                    {result.schema.indexesRemoved.map((i) => (
                      <div key={i.name} className="font-mono text-[12px]">
                        − {i.name} ({i.columns.join(", ")})
                      </div>
                    ))}
                  </DiffSection>
                )}
              </>
            )}
            {result.data && (
              <div className="rounded-lg border">
                <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-3 py-1.5 text-xs">
                  <span className="font-medium">Data diff</span>
                  <span>source rows: {result.data.sourceRows}</span>
                  <span>target rows: {result.data.targetRows}</span>
                  <span className="text-emerald-500">+{result.data.onlyInSource}</span>
                  <span className="text-amber-500">~{result.data.changed}</span>
                  <span className="text-destructive">−{result.data.onlyInTarget}</span>
                  {result.data.truncated && <Badge variant="warning">truncated</Badge>}
                </div>
                <pre className="scrollbar-thin max-h-64 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
                  {result.data.sql || "-- no row differences"}
                </pre>
              </div>
            )}
            {allSQL.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    Sync SQL preview
                    <Badge variant="secondary">{allSQL.length}</Badge>
                  </h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={copySQL}>
                      {copied ? <Check className="text-emerald-500" /> : <Copy />} Copy SQL
                    </Button>
                    <Button size="sm" onClick={() => void execute()} disabled={loading}>
                      {loading ? <Loader2 className="animate-spin" /> : <Play />} Execute on target
                    </Button>
                  </div>
                </div>
                <pre className="scrollbar-thin overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-[12px] leading-relaxed">
                  {allSQL.map((s) => s.replace(/;$/, "") + ";").join("\n")}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PickerGroup({
  label,
  connections,
  databases,
  tables,
  value,
  onChange,
}: {
  label: string;
  connections: Connection[];
  databases: DatabaseInfo[];
  tables: TableInfo[];
  value: Picker;
  onChange: (value: Picker) => void;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex gap-1.5">
        <Select
          value={value.connectionId}
          onValueChange={(id) => onChange({ connectionId: id, database: "", table: "" })}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="connection" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={value.database}
          onValueChange={(db) => onChange({ ...value, database: db, table: "" })}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="database" />
          </SelectTrigger>
          <SelectContent>
            {databases.filter((d) => !d.isSystem).map((d) => (
              <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={value.table} onValueChange={(table) => onChange({ ...value, table })}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="table" />
          </SelectTrigger>
          <SelectContent>
            {tables.map((t) => (
              <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function DiffSection({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: "emerald" | "destructive" | "amber";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "emerald" ? "text-emerald-500" : tone === "destructive" ? "text-destructive" : "text-amber-500";
  return (
    <div className="rounded-lg border">
      <div className={cn("flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium", toneClass)}>
        {title}
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{count}</Badge>
      </div>
      <div className="space-y-1 p-3">{children}</div>
    </div>
  );
}
