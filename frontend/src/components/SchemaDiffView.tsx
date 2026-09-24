import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Copy, GitCompare, Loader2, Play } from "lucide-react";
import { api } from "@/lib/api";
import type { DatabaseInfo, SchemaDiffResult, TableInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  connectionId: string;
  database: string;
}

interface Picker {
  database: string;
  table: string;
}

export function SchemaDiffView({ connectionId, database }: Props) {
  const { t } = useI18n();
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [source, setSource] = useState<Picker>({ database, table: "" });
  const [target, setTarget] = useState<Picker>({ database, table: "" });
  const [srcTables, setSrcTables] = useState<TableInfo[]>([]);
  const [tgtTables, setTgtTables] = useState<TableInfo[]>([]);
  const [result, setResult] = useState<SchemaDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.listDatabases(connectionId).then(setDatabases).catch(() => {});
  }, [connectionId]);

  useEffect(() => {
    if (!source.database) return;
    api.listTables(connectionId, source.database).then(setSrcTables).catch(() => {});
  }, [connectionId, source.database]);

  useEffect(() => {
    if (!target.database) return;
    api.listTables(connectionId, target.database).then(setTgtTables).catch(() => {});
  }, [connectionId, target.database]);

  const compare = async () => {
    if (!source.table || !target.table) {
      toast.error(t("diff.compare", "Compare") + ": select tables");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      setResult(await api.schemaDiff(connectionId, source, target));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const copyDdl = () => {
    if (!result) return;
    void navigator.clipboard.writeText(result.ddl.join(";\n") + (result.ddl.length ? ";" : "")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const execute = async () => {
    if (!result || result.ddl.length === 0) return;
    setLoading(true);
    try {
      for (const stmt of result.ddl) {
        await api.executeDDL(connectionId, target.database, stmt);
      }
      toast.success(`${t("diff.executed", "Executed")}: ${result.ddl.length}`);
      await compare();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const noDiff =
    result &&
    result.columnsAdded.length === 0 &&
    result.columnsRemoved.length === 0 &&
    result.columnsChanged.length === 0 &&
    result.indexesAdded.length === 0 &&
    result.indexesRemoved.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b px-3 py-2">
        <GitCompare className="mb-2 h-4 w-4 text-primary" />
        <PickerGroup
          label={t("diff.source", "Source (reference)")}
          databases={databases}
          tables={srcTables}
          value={source}
          onChange={(v) => setSource(v)}
        />
        <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" />
        <PickerGroup
          label={t("diff.target", "Target (to be changed)")}
          databases={databases}
          tables={tgtTables}
          value={target}
          onChange={(v) => setTarget(v)}
        />
        <Button className="mb-0.5" size="sm" onClick={() => void compare()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <GitCompare />}
          {t("diff.compare", "Compare")}
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4">
        {!result ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">
            {t("diff.title", "Schema diff")} — {t("diff.compare", "pick two tables and compare")}
          </p>
        ) : (
          <div className="space-y-4">
            {noDiff && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
                <Check className="h-4 w-4" /> {t("diff.noDiff", "Identical, no differences")}
              </div>
            )}

            <DiffSection title={t("diff.columnsAdded", "Columns added")} count={result.columnsAdded.length} tone="emerald">
              {result.columnsAdded.map((c) => (
                <div key={c.name} className="font-mono text-[12px]">
                  + {c.name} <span className="text-muted-foreground">{c.columnType}</span>
                </div>
              ))}
            </DiffSection>

            <DiffSection title={t("diff.columnsRemoved", "Columns removed")} count={result.columnsRemoved.length} tone="destructive">
              {result.columnsRemoved.map((c) => (
                <div key={c.name} className="font-mono text-[12px]">
                  − {c.name} <span className="text-muted-foreground">{c.columnType}</span>
                </div>
              ))}
            </DiffSection>

            <DiffSection title={t("diff.columnsChanged", "Columns changed")} count={result.columnsChanged.length} tone="amber">
              {result.columnsChanged.map((c) => (
                <div key={c.name} className="font-mono text-[12px]">
                  ~ {c.name}: <span className="text-muted-foreground">{c.target.columnType}</span> →{" "}
                  <span className="text-foreground">{c.source.columnType}</span>
                </div>
              ))}
            </DiffSection>

            <DiffSection title={t("diff.indexesAdded", "Indexes added")} count={result.indexesAdded.length} tone="emerald">
              {result.indexesAdded.map((i) => (
                <div key={i.name} className="font-mono text-[12px]">
                  + {i.name} ({i.columns.join(", ")}){i.unique ? " UNIQUE" : ""}
                </div>
              ))}
            </DiffSection>

            <DiffSection title={t("diff.indexesRemoved", "Indexes removed")} count={result.indexesRemoved.length} tone="destructive">
              {result.indexesRemoved.map((i) => (
                <div key={i.name} className="font-mono text-[12px]">
                  − {i.name} ({i.columns.join(", ")})
                </div>
              ))}
            </DiffSection>

            {result.ddl.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    {t("diff.ddl", "Generated SQL")}
                    <Badge variant="secondary">{result.ddl.length}</Badge>
                  </h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={copyDdl}>
                      {copied ? <Check className="text-emerald-500" /> : <Copy />}
                      {t("diff.copyDdl", "Copy SQL")}
                    </Button>
                    <Button size="sm" onClick={() => void execute()} disabled={loading}>
                      {loading ? <Loader2 className="animate-spin" /> : <Play />}
                      {t("diff.execute", "Execute SQL")}
                    </Button>
                  </div>
                </div>
                <pre className="scrollbar-thin overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-[12px] leading-relaxed">
                  {result.ddl.map((s) => s + ";").join("\n")}
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
  databases,
  tables,
  value,
  onChange,
}: {
  label: string;
  databases: DatabaseInfo[];
  tables: TableInfo[];
  value: Picker;
  onChange: (v: Picker) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="grid gap-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <div className="flex gap-1.5">
          <Select value={value.database} onValueChange={(db) => onChange({ database: db, table: "" })}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="database" />
            </SelectTrigger>
            <SelectContent>
              {databases
                .filter((d) => !d.isSystem)
                .map((d) => (
                  <SelectItem key={d.name} value={d.name}>
                    {d.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={value.table} onValueChange={(tb) => onChange({ ...value, table: tb })}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="table" />
            </SelectTrigger>
            <SelectContent>
              {tables.map((tb) => (
                <SelectItem key={tb.name} value={tb.name}>
                  {tb.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
  if (count === 0) return null;
  const toneClass =
    tone === "emerald" ? "text-emerald-500" : tone === "destructive" ? "text-destructive" : "text-amber-500";
  return (
    <div className="rounded-lg border">
      <div className={cn("flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium", toneClass)}>
        {title}
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {count}
        </Badge>
      </div>
      <div className="space-y-1 p-3">{children}</div>
    </div>
  );
}
