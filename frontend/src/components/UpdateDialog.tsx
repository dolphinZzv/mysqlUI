import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import type { UpdateStatus } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpdateDialog({ open, onOpenChange }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(10);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.updateStatus();
      setStatus(next);
      setEnabled(next.enabled);
      setIntervalMinutes(next.intervalMinutes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const save = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.setUpdateSettings(enabled, intervalMinutes);
      setStatus(next);
      setEnabled(next.enabled);
      setIntervalMinutes(next.intervalMinutes);
      toast.success(t("update.saved", "Update settings saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const next = await api.checkUpdate();
      setStatus(next);
      setEnabled(next.enabled);
      setIntervalMinutes(next.intervalMinutes);
      toast.success(
        next.updateAvailable
          ? t("update.available", "Version {v} is available", { v: next.latestVersion ?? "" })
          : t("update.upToDate", "Already up to date"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const res = await api.applyUpdate();
      toast.success(t("update.installed", "Installed {v}", { v: res.installed }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const restart = async () => {
    setRestarting(true);
    setError(null);
    try {
      await api.restartUpdate();
      toast.success(t("update.restarting", "Restarting…"));
      window.setTimeout(() => window.location.reload(), 1800);
    } catch (err) {
      setRestarting(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const busy = loading || checking || applying || restarting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" /> {t("update.title", "Software update")}
          </DialogTitle>
          <DialogDescription>
            {t("update.desc", "Keep MySQL UI up to date from GitHub releases.")}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("update.current", "Current")}</span>
            <span className="font-mono">{status?.currentVersion ?? "…"}</span>
            {status?.latestVersion && (
              <>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono">{status.latestVersion}</span>
              </>
            )}
            {status?.updateAvailable ? (
              <Badge variant="warning">{t("update.availableShort", "update available")}</Badge>
            ) : status?.latestVersion ? (
              <Badge variant="secondary">{t("update.upToDateShort", "up to date")}</Badge>
            ) : null}
          </div>
          {status?.lastChecked && (
            <p className="text-xs text-muted-foreground">
              {t("update.lastChecked", "Last checked")}: {new Date(status.lastChecked).toLocaleString()}
            </p>
          )}
          {status?.lastError && (
            <p className="break-all text-xs text-destructive">{status.lastError}</p>
          )}
          {status?.devBuild && (
            <p className="text-xs text-muted-foreground">
              {t("update.devBuild", "Development builds are not updated automatically.")}
            </p>
          )}
          {status?.installedVersion && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("update.installedVersion", "Installed {v}", { v: status.installedVersion })}
              {status.restartRequired && ` · ${t("update.restartRequired", "restart required")}`}
            </p>
          )}
          {status?.restartRequired && !status.canRestart && (
            <p className="text-xs text-muted-foreground">
              {t("update.restartManual", "Restart mysqlui manually to use the new version.")}
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="auto-update"
              checked={enabled}
              onCheckedChange={(v) => setEnabled(Boolean(v))}
              disabled={busy}
            />
            <Label htmlFor="auto-update" className="text-sm">
              {t("update.auto", "Automatic updates")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="update-interval" className="text-xs text-muted-foreground">
              {t("update.interval", "Check every")}
            </Label>
            <Input
              id="update-interval"
              type="number"
              min={1}
              max={1440}
              className="h-8 w-24"
              value={intervalMinutes}
              disabled={busy || !enabled}
              onChange={(e) => setIntervalMinutes(Number(e.target.value) || 10)}
            />
            <span className="text-xs text-muted-foreground">{t("update.minutes", "minutes")}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "update.autoHint",
              "Checks GitHub every {n} minutes and installs new releases automatically. Turn this off to check manually.",
              { n: intervalMinutes },
            )}
          </p>
          <Button size="sm" variant="outline" onClick={() => void save()} disabled={busy}>
            {loading ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {t("common.save", "Save")}
          </Button>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void check()} disabled={busy}>
              {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t("update.check", "Check now")}
            </Button>
            {status?.updateAvailable && (
              <Button onClick={() => void apply()} disabled={busy}>
                {applying ? <Loader2 className="animate-spin" /> : <Download />}
                {t("update.apply", "Update now")}
              </Button>
            )}
            {status?.restartRequired && status.canRestart && (
              <Button onClick={() => void restart()} disabled={busy}>
                {restarting ? <Loader2 className="animate-spin" /> : <RotateCw />}
                {t("update.restart", "Restart")}
              </Button>
            )}
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={restarting}>
            {t("common.close", "Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
