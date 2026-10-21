import { AlertTriangle, Loader2, Play } from "lucide-react";
import type { SqlRisk } from "@/lib/sqlRisk";
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
  sql: string;
  risks: SqlRisk[];
  estimatedRows: number | null;
  estimating: boolean;
  threshold: number;
  onCancel: () => void;
  onRun: () => void;
}

export function RiskDialog({ open, sql, risks, estimatedRows, estimating, threshold, onCancel, onRun }: Props) {
  const dangerous = risks.some((risk) => risk.level === "danger");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-500">
            <AlertTriangle className="h-4 w-4" /> Review before running
          </DialogTitle>
          <DialogDescription>
            This statement looks risky. Nothing has been executed yet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {risks.map((risk, i) => (
            <div
              key={i}
              className={
                risk.level === "danger"
                  ? "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  : "rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400"
              }
            >
              {risk.message}
            </div>
          ))}
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
            {estimating ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Estimating affected rows with EXPLAIN…
              </span>
            ) : estimatedRows === null ? (
              <span className="text-muted-foreground">No row estimate available for this statement.</span>
            ) : estimatedRows < 0 ? (
              <span className="text-muted-foreground">Row estimate unavailable; review the SQL manually.</span>
            ) : (
              <span>
                Estimated affected rows: <b>{estimatedRows.toLocaleString()}</b>
                {estimatedRows >= threshold && (
                  <span className="ml-2 text-amber-500">above the {threshold.toLocaleString()} row confirmation threshold</span>
                )}
              </span>
            )}
          </div>
          <pre className="scrollbar-thin max-h-56 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[12px]">
            {sql}
          </pre>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={dangerous ? "destructive" : "default"} onClick={onRun}>
            <Play /> Run anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
