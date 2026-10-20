import { ClipboardPaste, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PasteCellChange {
  rowIndex: number;
  column: string;
  value: unknown;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: PasteCellChange[];
  invalid: string[];
  start: string;
  onApply: () => void;
}

export function PasteCellsDialog({ open, onOpenChange, changes, invalid, start, onApply }: Props) {
  const preview = changes.slice(0, 200);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardPaste className="h-4 w-4 text-primary" /> Paste cells
          </DialogTitle>
          <DialogDescription>
            Paste starting at {start}. Values map by row and column; NULL (case-insensitive) becomes SQL NULL.
          </DialogDescription>
        </DialogHeader>
        {invalid.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
            <div className="mb-1 flex items-center gap-1 font-medium">
              <TriangleAlert className="h-3.5 w-3.5" /> {invalid.length} cell(s) cannot be pasted
            </div>
            <ul className="max-h-24 list-disc overflow-auto pl-5">
              {invalid.slice(0, 20).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {changes.length > 0 ? (
          <div className="scrollbar-thin max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/70">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Row</th>
                  <th className="px-2 py-1.5 font-medium">Column</th>
                  <th className="px-2 py-1.5 font-medium">New value</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((change, i) => (
                  <tr key={`${change.rowIndex}:${change.column}:${i}`} className="border-t">
                    <td className="px-2 py-1 tabular-nums text-muted-foreground">#{change.rowIndex + 1}</td>
                    <td className="px-2 py-1 font-mono">{change.column}</td>
                    <td className="max-w-[420px] truncate px-2 py-1 font-mono">
                      {change.value === null ? <span className="text-muted-foreground">NULL</span> : String(change.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {changes.length > preview.length && (
              <p className="border-t px-2 py-1 text-[11px] text-muted-foreground">
                Showing first {preview.length} of {changes.length} changes.
              </p>
            )}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing to paste.</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={changes.length === 0} onClick={onApply}>
            <ClipboardPaste /> Add {changes.length} pending change(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
