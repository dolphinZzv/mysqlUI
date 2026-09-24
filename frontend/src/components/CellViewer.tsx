import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Download, FileWarning, Image as ImageIcon, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { CellValue } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  database: string;
  table: string;
  column: string;
  primaryKey: Record<string, unknown> | null;
  initialValue: unknown;
  editable?: boolean;
  onSave?: (value: string) => Promise<void>;
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function CellViewer({
  open,
  onOpenChange,
  connectionId,
  database,
  table,
  column,
  primaryKey,
  initialValue,
  editable,
  onSave,
}: Props) {
  const { t } = useI18n();
  const [raw, setRaw] = useState<CellValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRaw(null);
    setLoading(true);
    const initialText = initialValue === null || initialValue === undefined ? "" : String(initialValue);
    setText(initialText);

    if (!primaryKey) {
      setLoading(false);
      return;
    }
    api
      .cellValue(connectionId, database, table, column, primaryKey)
      .then((res) => {
        setRaw(res);
        if (!res.isNull) {
          const decoded = atob(res.base64);
          try {
            const utf8 = decodeURIComponent(escape(decoded));
            setText(looksLikeJSON(utf8) ? JSON.stringify(JSON.parse(utf8), null, 2) : utf8);
          } catch {
            /* binary; keep grid value */
          }
        } else {
          setText("");
        }
      })
      .catch(() => {
        /* fall back to grid value */
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId, database, table, column]);

  const isImage = raw?.mime?.startsWith("image/") ?? false;
  const dataUrl = raw && !raw.isNull ? `data:${raw.mime};base64,${raw.base64}` : "";
  const isJSON = looksLikeJSON(text);

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => toast.success(t("structure.copied", "Copied")));
  };

  const download = () => {
    if (!raw) return;
    const bytes = Uint8Array.from(atob(raw.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: raw.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = column;
    a.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(text);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            {column}
            {raw && <Badge variant="secondary">{(raw.mime || "text").split(";")[0]}</Badge>}
            {raw && <Badge variant="outline">{formatBytes(raw.size)}</Badge>}
            {raw?.truncated && <Badge variant="warning">truncated</Badge>}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {database}.{table}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isImage && dataUrl ? (
          <div className="flex max-h-[60vh] items-center justify-center overflow-auto rounded-lg border bg-muted/20 p-4">
            <img src={dataUrl} alt={column} className="max-h-[55vh] max-w-full object-contain" />
          </div>
        ) : (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={!editable}
            spellCheck={false}
            className="scrollbar-thin h-[45vh] resize-none font-mono text-[12px]"
          />
        )}

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isImage ? <ImageIcon className="h-3.5 w-3.5" /> : isJSON ? null : <FileWarning className="h-3.5 w-3.5" />}
            {isJSON && !isImage ? "JSON" : ""}
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy /> {t("structure.copy", "Copy")}
            </Button>
            {raw && !raw.isNull && (
              <Button size="sm" variant="outline" onClick={download}>
                <Download /> {t("table.export", "Export")}
              </Button>
            )}
            {editable && onSave && (
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : null}
                {t("common.save", "Save")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function looksLikeJSON(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
