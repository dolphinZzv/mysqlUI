import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Copy,
  Database as DatabaseIcon,
  Eye,
  GitCompare,
  History,
  Loader2,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { DatabaseDiffResult, SchemaSnapshot } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface Props {
  connectionId: string;
  database: string;
}

const LIVE = "__live__";

export function SchemaVersionsView({ connectionId, database }: Props) {
  const { t } = useI18n();
  const [versions, setVersions] = useState<SchemaSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [base, setBase] = useState("");
  const [target, setTarget] = useState(LIVE);
  const [result, setResult] = useState<DatabaseDiffResult | null>(null);
  const [diffing, setDiffing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [copied, setCopied] = useState(false);

  const [sealOpen, setSealOpen] = useState(false);
  const [sealName, setSealName] = useState("");
  const [sealNote, setSealNote] = useState("");
  const [sealing, setSealing] = useState(false);
  const [viewing, setViewing] = useState<SchemaSnapshot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SchemaSnapshot | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listSchemaVersions(connectionId, database);
      setVersions(list);
      setBase((prev) => {
        if (prev && (prev === LIVE || list.some((v) => v.id === prev))) return prev;
        return list[0]?.id ?? LIVE;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    setResult(null);
    void refresh();
  }, [refresh]);

  const createSnapshot = async () => {
    setSealing(true);
    try {
      const snap = await api.createSchemaVersion(connectionId, {
        database,
        name: sealName.trim(),
        note: sealNote.trim(),
      });
      toast.success(t("versions.created", `Sealed "{name}"`, { name: snap.name }));
      setSealOpen(false);
      setSealName("");
      setSealNote("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSealing(false);
    }
  };

  const runDiff = async () => {
    setDiffing(true);
    setResult(null);
    try {
      const res = await api.diffSchemaVersions(connectionId, {
        database,
        base: { versionId: base === LIVE ? "" : base },
        target: { versionId: target === LIVE ? "" : target },
      });
      setResult(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDiffing(false);
    }
  };

  const copyDdl = () => {
    if (!result) return;
    void navigator.clipboard.writeText(result.ddl.join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const executeDdl = async () => {
    if (!result || result.ddl.length === 0) return;
    setExecuting(true);
    try {
      for (const stmt of result.ddl) {
        await api.executeDDL(connectionId, database, stmt);
      }
      toast.success(t("versions.executed", `Executed {n} statement(s)`, { n: result.ddl.length }));
      await runDiff();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteSchemaVersion(connectionId, deleteTarget.id);
      toast.success(t("versions.deleted", "Version deleted"));
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const label = (value: string) => {
    if (value === LIVE) return t("versions.live", "Current database (live)");
    return versions.find((v) => v.id === value)?.name ?? value;
  };

  const noDiff =
    result &&
    result.tablesAdded.length === 0 &&
    result.tablesRemoved.length === 0 &&
    result.tablesChanged.length === 0;

  const optionNodes = useMemo(
    () => (
      <>
        <SelectItem value={LIVE}>{t("versions.live", "Current database (live)")}</SelectItem>
        {versions.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.name}
          </SelectItem>
        ))}
      </>
    ),
    [versions, t]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <History className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{t("versions.title", "Schema versions")}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <DatabaseIcon className="h-3 w-3" />
          {database}
        </span>
        <Button size="sm" className="ml-auto" onClick={() => setSealOpen(true)}>
          <Plus /> {t("versions.seal", "Seal snapshot")}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-b bg-muted/20 px-3 py-2">
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("versions.base", "From (base)")}
          </Label>
          <Select value={base || LIVE} onValueChange={setBase}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{optionNodes}</SelectContent>
          </Select>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          className="mb-0.5"
          title={t("versions.swap", "Swap")}
          onClick={() => {
            setBase(target);
            setTarget(base);
          }}
        >
          <ArrowLeftRight className="h-4 w-4" />
        </Button>
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("versions.target", "To (target)")}
          </Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{optionNodes}</SelectContent>
          </Select>
        </div>
        <Button className="mb-0.5" size="sm" onClick={() => void runDiff()} disabled={diffing}>
          {diffing ? <Loader2 className="animate-spin" /> : <GitCompare />}
          {t("versions.compare", "Compare")}
        </Button>
        <span className="mb-1.5 text-xs text-muted-foreground">
          {label(base)} <ArrowRight className="inline h-3 w-3" /> {label(target)}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_1fr]">
        {/* Version list */}
        <div className="scrollbar-thin min-h-0 overflow-auto border-r">
          <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>{t("versions.list", "Sealed versions")}</span>
            <Badge variant="secondary">{versions.length}</Badge>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("versions.empty", "No versions yet. Seal a snapshot to get started.")}
            </p>
          ) : (
            <ul className="space-y-1 p-2">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className={cn(
                    "group rounded-md border px-2.5 py-2 text-sm transition-colors hover:bg-accent/50",
                    (base === v.id || target === v.id) && "border-primary/50 bg-primary/5"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium" title={v.name}>
                      {v.name}
                    </span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {v.tableCount} {t("versions.tables", "tables")}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                  </div>
                  {v.note && <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{v.note}</div>}
                  <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px]"
                      onClick={() => {
                        void api.getSchemaVersion(connectionId, v.id).then(setViewing).catch(() => {});
                      }}
                    >
                      <Eye className="h-3 w-3" /> {t("versions.view", "View")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px] text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(v)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Diff result */}
        <div className="scrollbar-thin min-h-0 overflow-auto p-4">
          {!result ? (
            <p className="pt-16 text-center text-sm text-muted-foreground">
              {t("versions.hint", "Pick a base and target above, then compare.")}
            </p>
          ) : (
            <div className="space-y-4">
              {noDiff && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
                  <Check className="h-4 w-4" /> {t("diff.noDiff", "Identical, no differences")}
                </div>
              )}

              {result.tablesAdded.length > 0 && (
                <DiffBox title={t("versions.tablesAdded", "Tables added")} count={result.tablesAdded.length} tone="emerald">
                  {result.tablesAdded.map((tb) => (
                    <div key={tb.name} className="font-mono text-[12px]">
                      + {tb.name}
                    </div>
                  ))}
                </DiffBox>
              )}
              {result.tablesRemoved.length > 0 && (
                <DiffBox title={t("versions.tablesRemoved", "Tables removed")} count={result.tablesRemoved.length} tone="destructive">
                  {result.tablesRemoved.map((tb) => (
                    <div key={tb.name} className="font-mono text-[12px]">
                      − {tb.name}
                    </div>
                  ))}
                </DiffBox>
              )}
              {result.tablesChanged.map((tb) => (
                <div key={tb.table} className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium text-amber-500">
                    ~ {tb.table}
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {tb.columnsAdded.length + tb.columnsRemoved.length + tb.columnsChanged.length + tb.indexesAdded.length + tb.indexesRemoved.length}
                    </Badge>
                  </div>
                  <div className="space-y-0.5 p-3 font-mono text-[12px]">
                    {tb.columnsAdded.map((c) => (
                      <div key={`ca-${c.name}`} className="text-emerald-500">
                        + {c.name} <span className="text-muted-foreground">{c.columnType}</span>
                      </div>
                    ))}
                    {tb.columnsRemoved.map((c) => (
                      <div key={`cr-${c.name}`} className="text-destructive">
                        − {c.name} <span className="text-muted-foreground">{c.columnType}</span>
                      </div>
                    ))}
                    {tb.columnsChanged.map((c) => (
                      <div key={`cc-${c.name}`} className="text-amber-500">
                        ~ {c.name}: <span className="text-muted-foreground">{c.target.columnType}</span> →{" "}
                        <span className="text-foreground">{c.source.columnType}</span>
                      </div>
                    ))}
                    {tb.indexesAdded.map((i) => (
                      <div key={`ia-${i.name}`} className="text-emerald-500">
                        + index {i.name} ({i.columns.join(", ")}){i.unique ? " UNIQUE" : ""}
                      </div>
                    ))}
                    {tb.indexesRemoved.map((i) => (
                      <div key={`ir-${i.name}`} className="text-destructive">
                        − index {i.name} ({i.columns.join(", ")})
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {result.ddl.length > 0 && (
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      {t("diff.ddl", "Generated SQL")}
                      <Badge variant="secondary">{result.ddl.length}</Badge>
                    </h3>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={copyDdl}>
                        {copied ? <Check className="text-emerald-500" /> : <Copy />}
                        {t("diff.copyDdl", "Copy SQL")}
                      </Button>
                      <Button size="sm" onClick={() => void executeDdl()} disabled={executing || target !== LIVE}>
                        {executing ? <Loader2 className="animate-spin" /> : <Play />}
                        {t("versions.apply", "Apply to live")}
                      </Button>
                    </div>
                  </div>
                  <pre className="scrollbar-thin overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-[12px] leading-relaxed">
                    {result.ddl.join("\n")}
                  </pre>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("versions.applyHint", "Apply runs these statements on the live database (target = live only).")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Seal dialog */}
      <Dialog open={sealOpen} onOpenChange={setSealOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              {t("versions.seal", "Seal snapshot")}
            </DialogTitle>
            <DialogDescription>
              {t("versions.sealDesc", "Capture the current structure of {db} as a version.", { db: database })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label htmlFor="version-name">{t("versions.name", "Version name")}</Label>
              <Input
                id="version-name"
                placeholder="v1.0.0"
                value={sealName}
                onChange={(e) => setSealName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="version-note">{t("versions.note", "Note (optional)")}</Label>
              <Textarea
                id="version-note"
                rows={3}
                placeholder={t("versions.notePlaceholder", "What changed in this version?")}
                value={sealNote}
                onChange={(e) => setSealNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSealOpen(false)} disabled={sealing}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={() => void createSnapshot()} disabled={sealing}>
              {sealing ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("versions.seal", "Seal snapshot")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View snapshot */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm">
              {viewing?.name}
              <Badge variant="outline">{viewing?.tables?.length ?? viewing?.tableCount ?? 0} tables</Badge>
            </DialogTitle>
            <DialogDescription>
              {viewing && new Date(viewing.createdAt).toLocaleString()} · {viewing?.database}
            </DialogDescription>
          </DialogHeader>
          <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-auto py-2">
            {viewing?.tables?.map((tb) => (
              <div key={tb.name} className="rounded-lg border">
                <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium">
                  {tb.name}
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {tb.type === "VIEW" ? "view" : `${tb.columns.length} cols`}
                  </Badge>
                </div>
                <pre className="scrollbar-thin overflow-x-auto p-3 font-mono text-[11px] leading-relaxed">
                  {tb.createSql || "-- (no DDL captured)"}
                </pre>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" /> {t("versions.deleteTitle", "Delete this version?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("versions.deleteDesc", "The sealed snapshot will be removed. The database itself is not touched.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void remove()}
            >
              {t("common.delete", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DiffBox({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: "emerald" | "destructive";
  children: React.ReactNode;
}) {
  const toneClass = tone === "emerald" ? "text-emerald-500" : "text-destructive";
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
