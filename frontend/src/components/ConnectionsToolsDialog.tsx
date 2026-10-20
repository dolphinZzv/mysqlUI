import { useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, Download, Loader2, Server, Upload, XCircle } from "lucide-react";
import { api, connectionsExportUrl, triggerDownload } from "@/lib/api";
import type { Connection, ConnectionImportResult, ConnectionTestSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  connections: Connection[];
  onChanged: () => void;
}

export function ConnectionsToolsDialog({ open, onOpenChange, connections, onChanged }: Props) {
  const [includePasswords, setIncludePasswords] = useState(false);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<ConnectionTestSummary[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ConnectionImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const testAll = async () => {
    setTesting(true);
    try {
      setResults(await api.testAllConnections());
    } catch (err) {
      toast.error("Batch test failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const clone = async (connection: Connection) => {
    try {
      const res = await api.cloneConnection(connection.id);
      toast.success(`Cloned as "${res.connection.name}"`);
      onChanged();
    } catch (err) {
      toast.error("Clone failed", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const importFile = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { connections?: Connection[] } | Connection[];
      const list = Array.isArray(parsed) ? parsed : parsed.connections;
      if (!Array.isArray(list)) throw new Error("Expected an array or an object with a connections array");
      const res = await api.importConnections(list);
      setImportResult(res);
      onChanged();
      toast.success(`Imported ${res.imported.length} connection(s)`);
    } catch (err) {
      toast.error("Import failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setImporting(false);
    }
  };

  const connected = results?.filter((r) => r.connected).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" /> Connection tools
          </DialogTitle>
          <DialogDescription>
            Test every connection, clone a profile, or move connection profiles between installations.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="space-y-2 rounded-lg border p-3">
            <h3 className="text-sm font-medium">Batch connection test</h3>
            <Button size="sm" variant="outline" onClick={() => void testAll()} disabled={testing}>
              {testing ? <Loader2 className="animate-spin" /> : <Server />} Test all
            </Button>
            {results && (
              <div className="scrollbar-thin max-h-52 overflow-auto rounded border text-xs">
                <div className="border-b bg-muted/40 px-2 py-1 text-muted-foreground">
                  {connected}/{results.length} connected
                </div>
                {results.map((result) => (
                  <div key={result.id} className="flex items-center gap-2 border-b px-2 py-1 last:border-0">
                    {result.connected ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    )}
                    <span className="truncate font-medium">{result.name}</span>
                    <span className="ml-auto text-muted-foreground">
                      {result.connected ? `${result.latencyMs ?? 0} ms` : result.error}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2 rounded-lg border p-3">
            <h3 className="text-sm font-medium">Export / import profiles</h3>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={includePasswords} onCheckedChange={(v) => setIncludePasswords(Boolean(v))} />
              <span>Include passwords and SSH secrets</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => triggerDownload(connectionsExportUrl(includePasswords))}>
                <Download /> Export JSON
              </Button>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
                {importing ? <Loader2 className="animate-spin" /> : <Upload />} Import JSON
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void importFile(file);
                }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Imports never overwrite silently: name conflicts are renamed with an “(imported)” suffix, and invalid entries are reported.
            </p>
            {importResult && (
              <div className="space-y-1 text-xs">
                <div className="flex gap-2">
                  <Badge variant="secondary">imported {importResult.imported.length}</Badge>
                  <Badge variant={importResult.skipped.length ? "warning" : "secondary"}>
                    skipped {importResult.skipped.length}
                  </Badge>
                </div>
                {importResult.skipped.map((item, i) => (
                  <p key={i} className="break-all text-destructive">
                    {item.name}: {item.reason}
                  </p>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-lg border">
          <h3 className="border-b bg-muted/30 px-3 py-1.5 text-sm font-medium">Clone a connection</h3>
          <div className="scrollbar-thin max-h-48 overflow-auto">
            {connections.map((connection) => (
              <div key={connection.id} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-0">
                <span className="truncate text-xs font-medium">{connection.name}</span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {connection.user}@{connection.host}:{connection.port}
                </span>
                <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => void clone(connection)}>
                  <Copy /> Clone
                </Button>
              </div>
            ))}
            {connections.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">No connections.</p>
            )}
          </div>
        </section>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
