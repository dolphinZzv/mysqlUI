import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { HardDriveDownload, Loader2, Save } from "lucide-react";
import { api } from "@/lib/api";
import type { BackupStatus } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.backupStatus();
      setStatus(next);
      setEnabled(next.enabled);
      setIntervalHours(next.intervalHours);
      setRetentionDays(next.retentionDays);
      setDirectory(next.directory);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

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
      toast.success(t("backup.done", "Backup completed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDriveDownload className="h-4 w-4 text-primary" /> {t("backup.title", "Scheduled backups")}
          </DialogTitle>
          <DialogDescription>
            {t("backup.desc", "Dump every connection/database to .sql files on a schedule.")}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="break-all text-xs text-destructive">{error}</p>}

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
            <Label>{t("backup.enabled", "Enable scheduled backups")}</Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("backup.interval", "Interval (hours)")}</Label>
              <Input type="number" min={1} className="h-8" value={intervalHours} onChange={(e) => setIntervalHours(Number(e.target.value) || 24)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("backup.retention", "Retention (days)")}</Label>
              <Input type="number" min={1} className="h-8" value={retentionDays} onChange={(e) => setRetentionDays(Number(e.target.value) || 7)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("backup.directory", "Backup directory")}</Label>
            <Input className="h-8 font-mono text-xs" value={directory} onChange={(e) => setDirectory(e.target.value)} />
          </div>
          {status?.lastRun && (
            <p className="text-xs text-muted-foreground">
              {t("backup.lastRun", "Last run")}: {new Date(status.lastRun).toLocaleString()}
            </p>
          )}
          {status?.lastError && <p className="break-all text-xs text-destructive">{status.lastError}</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />} {t("common.save", "Save")}
            </Button>
            <Button variant="outline" onClick={() => void run()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <HardDriveDownload />} {t("backup.run", "Backup now")}
            </Button>
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.close", "Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
