import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Database, FileSpreadsheet, FileText, Loader2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  connectionName: string;
  database: string | null;
  table?: string | null;
  onDone?: () => void;
}

export function ImportDialog({ open, onOpenChange, connectionId, connectionName, database, table, onDone }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"csv" | "sql">(table ? "csv" : "sql");
  const [file, setFile] = useState<File | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [truncate, setTruncate] = useState(false);
  const [nullValue, setNullValue] = useState("");
  const [delimiter, setDelimiter] = useState(",");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode(table ? "csv" : "sql");
      setFile(null);
      setBusy(false);
    }
  }, [open, table]);

  const submit = async () => {
    if (!file) {
      toast.error(t("import.file", "Choose a file"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "csv") {
        if (!table || !database) throw new Error("CSV import requires a table");
        const res = await api.importCSV(connectionId, database, table, file, {
          hasHeader,
          truncate,
          nullValue,
          delimiter,
        });
        toast.success(`${t("import.done", "Import complete")}: ${res.imported} ${t("import.rows", "rows")}`);
      } else {
        const res = await api.importSQL(connectionId, database, file);
        toast.success(`${t("import.done", "Import complete")}: ${res.statements} ${t("import.statements", "statements")}`);
      }
      onDone?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" /> {t("import.title", "Import data")}
          </DialogTitle>
          <DialogDescription>
            {connectionName}
            {database ? ` / ${database}` : ""}
            {table ? ` / ${table}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={!table || !database}
            onClick={() => setMode("csv")}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-40",
              mode === "csv" ? "border-primary bg-primary/10" : "hover:bg-accent"
            )}
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
            {t("import.csv", "Import CSV into table")}
          </button>
          <button
            onClick={() => setMode("sql")}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm",
              mode === "sql" ? "border-primary bg-primary/10" : "hover:bg-accent"
            )}
          >
            <FileText className="h-4 w-4 text-sky-400" />
            {t("import.sql", "Import / restore SQL")}
          </button>
        </div>

        <div
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center"
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept={mode === "csv" ? ".csv,.tsv,.txt" : ".sql,.txt"}
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
          <span className="text-sm">{file ? file.name : t("import.file", "Choose a file")}</span>
          {file && <span className="mt-0.5 text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>}
        </div>

        {mode === "csv" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("import.delimiter", "Delimiter")}</Label>
                <Input className="h-8" value={delimiter} onChange={(e) => setDelimiter(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("import.nullValue", "NULL marker")}</Label>
                <Input
                  className="h-8"
                  placeholder="\\N"
                  value={nullValue}
                  onChange={(e) => setNullValue(e.target.value)}
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              {t("import.hasHeader", "First row contains column names")}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={truncate} onChange={(e) => setTruncate(e.target.checked)} />
              {t("import.truncate", "Truncate table before import")}
            </label>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {database
                ? "Statements run against the current database. USE/DELIMITER directives are supported."
                : "Runs against the server (statements may include USE)."}
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !file}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            {busy ? t("import.importing", "Importing…") : t("import.submit", "Start import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
