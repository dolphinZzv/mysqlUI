import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, HardDriveDownload, Loader2, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { api, backupDownloadUrl, triggerDownload } from "@/lib/api";
import type { BackupFile, BackupStatus, Connection } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fileSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function BackupDialog({ open, onOpenChange }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState(24);
  const [retentionDays, setRetentionDays] = useState(7);
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<BackupFile | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null);
  const [restoreConnection, setRestoreConnection] = useState("");
  const [restoreDatabase, setRestoreDatabase] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [next, fileList, conns] = await Promise.all([
        api.backupStatus(),
        api.listBackupFiles().catch(() => [] as BackupFile[]),
        api.listConnections().catch(() => [] as Connection[]),
      ]);
      setStatus(next);
      setEnabled(next.enabled);
      setIntervalHours(next.intervalHours);
      setRetentionDays(next.retentionDays);
      setDirectory(next.directory);
      setFiles(fileList);
      setConnections(conns);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadFiles = async () => {
    try {
      setFiles(await api.listBackupFiles());
    } catch (err) {
      toast.error("Could not list backup files", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.setBackupSettings({ enabled, intervalHours, retentionDays, directory });
      setStatus(next);
      toast.success(t("backup.saved", "Backup settings saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.runBackup();
      setStatus(next);
      await loadFiles();
      toast.success(t("backup.done", "Backup completed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openRestore = (file: BackupFile) => {
    setRestoreTarget(file);
    const match = connections.find((c) => c.name === file.connection) ?? connections[0];
    setRestoreConnection(match?.id ?? "");
    setRestoreDatabase(file.database);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteBackupFile(deleteTarget.id);
      toast.success("Backup deleted");
      setDeleteTarget(null);
      await loadFiles();
    } catch (err) {
      toast.error("Delete failed", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget || !restoreConnection) return;
    setRestoreBusy(true);
    try {
      const res = await api.restoreBackupFile(restoreTarget.id, restoreConnection, restoreDatabase.trim());
      toast.success(`Restore completed: ${res.statements} statement(s)`);
      setRestoreTarget(null);
    } catch (err) {
      toast.error("Restore failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setRestoreBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDriveDownload className="h-4 w-4 text-primary" /> {t("backup.title", "Scheduled backups")}
          </DialogTitle>
          <DialogDescription>
            {t("backup.desc", "Dump every connection/database to .sql files on a schedule.")}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="break-all text-xs text-destructive">{error}</p>}

        <div className="grid gap-4 sm:grid-cols-[260px_1fr]">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
              <Label>{t("backup.enabled", "Enable scheduled backups")}</Label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">{t("backup.interval", "Interval (h)")}</Label>
                <Input type="number" min={1} className="h-8" value={intervalHours} onChange={(e) => setIntervalHours(Number(e.target.value) || 24)} />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">{t("backup.retention", "Retention (d)")}</Label>
                <Input type="number" min={1} className="h-8" value={retentionDays} onChange={(e) => setRetentionDays(Number(e.target.value) || 7)} />
              </div>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t("backup.directory", "Backup directory")}</Label>
              <Input className="h-8 font-mono text-xs" value={directory} onChange={(e) => setDirectory(e.target.value)} />
            </div>
            {status?.lastRun && (
              <p className="text-xs text-muted-foreground">
                {t("backup.lastRun", "Last run")}: {new Date(status.lastRun).toLocaleString()}
              </p>
            )}
            {status?.lastError && <p className="break-all text-xs text-destructive">{status.lastError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />} {t("common.save", "Save")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <HardDriveDownload />} {t("backup.run", "Backup now")}
              </Button>
            </div>
          </div>

          <div className="flex min-h-[280px] flex-col rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium">Backup files</span>
              <Badge variant="secondary">{files.length}</Badge>
              <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={() => void loadFiles()} title="Refresh">
                <RefreshCw />
              </Button>
            </div>
            <div className="scrollbar-thin max-h-80 min-h-0 flex-1 overflow-auto">
              {files.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No backup files yet.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Database</th>
                      <th className="px-3 py-1.5 font-medium">Connection</th>
                      <th className="px-3 py-1.5 font-medium">Size</th>
                      <th className="px-3 py-1.5 font-medium">Modified</th>
                      <th className="px-3 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => (
                      <tr key={file.id} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-1.5">
                          <div className="font-mono">{file.database}</div>
                          <div className="truncate text-[10px] text-muted-foreground" title={file.name}>
                            {file.name}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{file.connection || "—"}</td>
                        <td className="px-3 py-1.5 tabular-nums">{fileSize(file.size)}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {new Date(file.modified).toLocaleString()}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Download"
                              onClick={() => triggerDownload(backupDownloadUrl(file.id))}
                            >
                              <Download />
                            </Button>
                            <Button size="icon-sm" variant="ghost" title="Restore" onClick={() => openRestore(file)}>
                              <Upload />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="hover:text-destructive"
                              title="Delete"
                              onClick={() => setDeleteTarget(file)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
              {formatNumber(files.reduce((sum, file) => sum + file.size, 0))} bytes total
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.close", "Close")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" /> Delete backup file?
            </AlertDialogTitle>
            <AlertDialogDescription className="font-mono">{deleteTarget?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={restoreTarget !== null} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" /> Restore backup
            </DialogTitle>
            <DialogDescription>
              {restoreTarget?.name}. This runs every statement in the dump; confirm before continuing.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Target connection</Label>
              <Select value={restoreConnection} onValueChange={setRestoreConnection}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a connection" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Database</Label>
              <Input
                className="h-8 font-mono text-xs"
                placeholder="default database"
                value={restoreDatabase}
                onChange={(e) => setRestoreDatabase(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoreTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmRestore()} disabled={restoreBusy || !restoreConnection}>
              {restoreBusy ? <Loader2 className="animate-spin" /> : <Upload />} Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
