import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: string[];
  onSubmit: (columns: string[], rows: unknown[][]) => Promise<void>;
}

function parseText(text: string): string[][] {
  const clean = text.replace(/\r/g, "").replace(/\n$/, "");
  if (!clean) return [];
  const lines = clean.split("\n").filter((l) => l.length > 0);
  const delimiter = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
}

export function PasteRowsDialog({ open, onOpenChange, columns, onSubmit }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText("");
    setHasHeader(true);
    setBusy(false);
    void navigator.clipboard
      .readText()
      .then((clip) => {
        if (clip) setText(clip);
      })
      .catch(() => {});
  }, [open]);

  const parsed = useMemo(() => parseText(text), [text]);

  const mapping = useMemo(() => {
    if (parsed.length === 0) return { columns: [] as string[], rows: [] as unknown[][] };
    const first = parsed[0];
    if (hasHeader) {
      const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
      const mapped = first.map((h) => lower.get(h.trim().toLowerCase()));
      if (mapped.some((c) => !c)) {
        return { columns: [], rows: [], error: t("paste.badHeader", "Header contains unknown columns") };
      }
      return {
        columns: mapped as string[],
        rows: parsed.slice(1).map((r) => mapped.map((_, i) => (r[i] === undefined ? null : r[i]))),
      };
    }
    const mapped = columns.slice(0, first.length);
    return {
      columns: mapped,
      rows: parsed.map((r) => mapped.map((_, i) => (r[i] === undefined ? null : r[i]))),
    };
  }, [parsed, hasHeader, columns, t]);

  const submit = async () => {
    if (mapping.columns.length === 0 || mapping.rows.length === 0) {
      toast.error(t("paste.empty", "Paste some rows first"));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(mapping.columns, mapping.rows);
      onOpenChange(false);
    } catch (err) {
      toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardPaste className="h-4 w-4 text-primary" /> {t("paste.title", "Paste rows")}
          </DialogTitle>
          <DialogDescription>
            {t("paste.desc", "Paste tab-separated data from Excel/Sheets. The first row can contain column names.")}
          </DialogDescription>
        </DialogHeader>

        <Textarea
          className="min-h-[220px] font-mono text-[12px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("paste.placeholder", "col1\tcol2\nvalue1\tvalue2")}
          spellCheck={false}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={hasHeader} onCheckedChange={(v) => setHasHeader(Boolean(v))} />
          <Label>{t("paste.hasHeader", "First row contains column names")}</Label>
        </label>

        {(mapping as { error?: string }).error && (
          <p className="text-xs text-destructive">{(mapping as { error?: string }).error}</p>
        )}
        {mapping.rows.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  {mapping.columns.map((c) => (
                    <th key={c} className="px-2 py-1 font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mapping.rows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-t">
                    {row.map((value, j) => (
                      <td key={j} className="max-w-[220px] truncate px-2 py-1 font-mono">
                        {value === null ? "NULL" : String(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || mapping.rows.length === 0}>
            {busy ? <Loader2 className="animate-spin" /> : <ClipboardPaste />}
            {t("paste.submit", "Insert {n} rows", { n: mapping.rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
