import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Database, FileJson, FileSpreadsheet, FileText, Loader2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import type { ImportPreview } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const [mode, setMode] = useState<"csv" | "json" | "excel" | "sql">(table ? "csv" : "sql");
  const [file, setFile] = useState<File | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [truncate, setTruncate] = useState(false);
  const [nullValue, setNullValue] = useState("");
  const [delimiter, setDelimiter] = useState(",");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState("error");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode(table ? "csv" : "sql");
      setFile(null);
      setBusy(false);
      setPreview(null);
      setMapping([]);
      setConflict("error");
    }
  }, [open, table]);

  const loadPreview = async (selected: File, delimiterValue = delimiter) => {
    if (!table || !database) return;
    if (!/\.(csv|tsv|txt|xlsx|xls)$/i.test(selected.name)) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      const result = await api.previewImport(connectionId, database, table, selected, {
        delimiter: delimiterValue === "," ? "auto" : delimiterValue,
        hasHeader,
      });
      setPreview(result);
      if (result.detectedDelimiter) setDelimiter(result.detectedDelimiter === "\t" ? "\t" : result.detectedDelimiter);
      const target = result.targetColumns;
      const nextMapping = result.sourceColumns.map((sourceName, index) => {
        const match = target.find((column) => column.toLowerCase() === sourceName.trim().toLowerCase());
        return match ?? target[index] ?? "";
      });
      setMapping(nextMapping);
    } catch (err) {
      setPreview(null);
      toast.error("Preview failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async () => {
    if (!file) {
      toast.error(t("import.file", "Choose a file"));
      return;
    }
    if (mapping.some((column) => !column)) {
      toast.error("Map every source column or exclude it before importing");
      return;
    }
    if (new Set(mapping).size !== mapping.length) {
      toast.error("Two source columns map to the same target column");
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
          mapping: mapping.length ? mapping : undefined,
          conflict,
        });
        toast.success(`${t("import.done", "Import complete")}: ${res.imported} ${t("import.rows", "rows")}`);
      } else if (mode === "json") {
        if (!table || !database) throw new Error("JSON import requires a table");
        const res = await api.importJSON(connectionId, database, table, file, truncate);
        toast.success(`${t("import.done", "Import complete")}: ${res.imported} ${t("import.rows", "rows")}`);
      } else if (mode === "excel") {
        if (!table || !database) throw new Error("Excel import requires a table");
        const res = await api.importExcel(connectionId, database, table, file, {
          hasHeader,
          truncate,
          mapping: mapping.length ? mapping : undefined,
          conflict,
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
            {t("import.csv", "Import CSV")}
          </button>
          <button
            disabled={!table || !database}
            onClick={() => setMode("json")}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-40",
              mode === "json" ? "border-primary bg-primary/10" : "hover:bg-accent"
            )}
          >
            <FileJson className="h-4 w-4 text-amber-400" />
            {t("import.json", "Import JSON")}
          </button>
          <button
            disabled={!table || !database}
            onClick={() => setMode("excel")}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-40",
              mode === "excel" ? "border-primary bg-primary/10" : "hover:bg-accent"
            )}
          >
            <FileSpreadsheet className="h-4 w-4 text-sky-400" />
            {t("import.excel", "Import Excel")}
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
            accept={mode === "csv" ? ".csv,.tsv,.txt" : mode === "json" ? ".json" : mode === "excel" ? ".xlsx,.xls" : ".sql,.txt"}
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              setFile(selected);
              setPreview(null);
              setMapping([]);
              if (selected) void loadPreview(selected);
            }}
          />
          <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
          <span className="text-sm">{file ? file.name : t("import.file", "Choose a file")}</span>
          {file && <span className="mt-0.5 text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>}
        </div>

        {mode === "csv" || mode === "excel" || mode === "json" ? (
          <div className="space-y-3">
            {mode === "csv" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">{t("import.delimiter", "Delimiter")}</Label>
                  <Input
                    className="h-8"
                    value={delimiter}
                    placeholder="auto"
                    onChange={(e) => setDelimiter(e.target.value)}
                    onBlur={(e) => {
                      if (file) void loadPreview(file, e.target.value);
                    }}
                  />
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
            )}
            {(mode === "csv" || mode === "excel") && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={hasHeader}
                  onChange={(e) => {
                    setHasHeader(e.target.checked);
                    if (file) void loadPreview(file);
                  }}
                />
                {t("import.hasHeader", "First row contains column names")}
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">On duplicate key</Label>
                <Select value={conflict} onValueChange={setConflict}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="error">Fail the import</SelectItem>
                    <SelectItem value="ignore">Skip duplicate rows (INSERT IGNORE)</SelectItem>
                    <SelectItem value="replace">Replace duplicates (REPLACE INTO)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Encoding</Label>
                <div className="flex h-8 items-center rounded-md border px-2 text-xs text-muted-foreground">
                  {previewing ? "detecting…" : preview?.encoding || "auto-detect (UTF-8 / GB18030)"}
                </div>
              </div>
            </div>
            {preview && (
              <div className="space-y-2 rounded-md border p-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium">Column mapping</span>
                  <span className="text-muted-foreground">
                    {preview.sourceColumns.length} source → {preview.targetColumns.length} target
                  </span>
                  {preview.detectedDelimiter && (
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      delimiter: {preview.detectedDelimiter === "\t" ? "TAB" : preview.detectedDelimiter}
                    </span>
                  )}
                </div>
                <div className="scrollbar-thin max-h-44 overflow-auto">
                  <table className="w-max min-w-full border-separate border-spacing-0 text-[11px]">
                    <thead className="sticky top-0 bg-muted/70">
                      <tr>
                        {preview.sourceColumns.map((source, index) => (
                          <th key={`${source}:${index}`} className="border-b border-r px-1.5 py-1 text-left font-medium">
                            <div className="mb-1 max-w-[120px] truncate font-mono text-[10px] text-muted-foreground" title={source}>
                              {source || `#${index + 1}`}
                            </div>
                            <Select
                              value={mapping[index] ?? ""}
                              onValueChange={(value) =>
                                setMapping((prev) => {
                                  const next = [...prev];
                                  next[index] = value;
                                  return next;
                                })
                              }
                            >
                              <SelectTrigger className="h-6 w-[130px] text-[10px]">
                                <SelectValue placeholder="skip" />
                              </SelectTrigger>
                              <SelectContent>
                                {preview.targetColumns.map((column) => (
                                  <SelectItem key={column} value={column}>
                                    {column}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 10).map((row, r) => (
                        <tr key={r}>
                          {preview.sourceColumns.map((_, c) => (
                            <td key={c} className="max-w-[140px] truncate border-b border-r px-1.5 py-1 font-mono" title={row[c]}>
                              {row[c] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
