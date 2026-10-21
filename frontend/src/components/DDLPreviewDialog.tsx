import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  title?: string;
  sql: string;
  warnings?: string[];
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
}

export function DDLPreviewDialog({
  open,
  onOpenChange,
  title = "Preview SQL change",
  sql,
  warnings = [],
  busy = false,
  confirmLabel = "Execute",
  onConfirm,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Review the generated DDL before it is sent to the server. Nothing has been executed yet.
          </DialogDescription>
        </DialogHeader>
        {warnings.length > 0 && (
          <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            {warnings.map((warning, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
        <pre className="scrollbar-thin max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[12px] leading-relaxed">
          {sql}
        </pre>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
