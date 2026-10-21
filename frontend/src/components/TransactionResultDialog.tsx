import { CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
import type { TransactionResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  result: TransactionResult | null;
  running?: boolean;
}

export function TransactionResultDialog({ open, onOpenChange, result, running }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : result?.committed ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <RotateCcw className="h-4 w-4 text-destructive" />}
            Transaction execution
          </DialogTitle>
          <DialogDescription>
            Statements run on one connection. A failure rolls back the whole batch; DDL is rejected because it implicitly commits.
          </DialogDescription>
        </DialogHeader>
        {running ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Executing statements…
          </div>
        ) : result ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={result.committed ? "default" : "destructive"}>
                {result.committed ? "COMMITTED" : "ROLLED BACK"}
              </Badge>
              <span className="text-muted-foreground">{result.executed} statement(s) succeeded</span>
              {result.error && <span className="text-destructive">{result.error}</span>}
            </div>
            <div className="scrollbar-thin max-h-80 overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted/70 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">#</th>
                    <th className="px-2 py-1.5 font-medium">Statement</th>
                    <th className="px-2 py-1.5 font-medium">Result</th>
                    <th className="px-2 py-1.5 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((item) => (
                    <tr key={item.statement} className="border-t">
                      <td className="px-2 py-1 tabular-nums text-muted-foreground">{item.statement}</td>
                      <td className="max-w-[460px] px-2 py-1 font-mono text-[11px]" title={item.preview}>
                        <span className="block truncate">{item.preview}</span>
                      </td>
                      <td className="px-2 py-1">
                        {item.success ? (
                          <span className="flex items-center gap-1 text-emerald-500">
                            <CheckCircle2 className="h-3 w-3" /> {item.message || `${item.affected} affected`}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-destructive" title={item.error}>
                            <XCircle className="h-3 w-3" /> {item.error}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 tabular-nums text-muted-foreground">{item.durationMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
