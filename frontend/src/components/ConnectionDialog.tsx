import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, PlugZap, Save, Server } from "lucide-react";
import { api } from "@/lib/api";
import type { Connection, ConnectionInput } from "@/lib/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: Connection | null;
  onSaved: (connection: Connection) => void;
}

const emptyForm: ConnectionInput = {
  name: "",
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "",
  database: "",
  ssl: "disabled",
};

export function ConnectionDialog({ open, onOpenChange, connection, onSaved }: Props) {
  const [form, setForm] = useState<ConnectionInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (open) {
      setStatus(null);
      setForm(
        connection
          ? {
              name: connection.name,
              host: connection.host,
              port: connection.port,
              user: connection.user,
              password: connection.password,
              database: connection.database || "",
              ssl: connection.ssl || "disabled",
            }
          : emptyForm
      );
    }
  }, [open, connection]);

  const set = <K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const res = await api.testNewConnection(form);
      if (res.connected) {
        setStatus({ ok: true, message: `Connected in ${res.latencyMs ?? 0} ms` });
      } else {
        setStatus({ ok: false, message: res.error || "Connection failed" });
      }
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    if (!form.name.trim() || !form.host.trim() || !form.user.trim()) {
      toast.error("Name, host and user are required");
      return;
    }
    setSaving(true);
    try {
      const res = connection
        ? await api.updateConnection(connection.id, form)
        : await api.createConnection(form);
      onSaved(res.connection);
      if (res.connected) {
        toast.success(connection ? "Connection updated" : "Connection created");
      } else {
        toast.warning("Saved, but could not connect", { description: res.error });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to save connection", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            {connection ? "Edit connection" : "New connection"}
          </DialogTitle>
          <DialogDescription>
            Configure a MySQL / MariaDB server. Credentials are stored locally on the backend.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="name">Connection name</Label>
            <Input
              id="name"
              placeholder="My production db"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 grid gap-2">
              <Label htmlFor="host">Host</Label>
              <Input id="host" value={form.host} onChange={(e) => set("host", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                value={form.port}
                onChange={(e) => set("port", Number(e.target.value) || 3306)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="user">User</Label>
              <Input id="user" value={form.user} onChange={(e) => set("user", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="database">Default database (optional)</Label>
              <Input
                id="database"
                placeholder="leave empty"
                value={form.database}
                onChange={(e) => set("database", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>SSL</Label>
              <Select value={form.ssl || "disabled"} onValueChange={(v) => set("ssl", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="preferred">Preferred</SelectItem>
                  <SelectItem value="skip-verify">Required (skip verify)</SelectItem>
                  <SelectItem value="true">Required (verify)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {status && (
            <div
              className={
                "rounded-md border px-3 py-2 text-sm " +
                (status.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                  : "border-destructive/30 bg-destructive/10 text-destructive")
              }
            >
              {status.message}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={onTest} disabled={testing || saving}>
            {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
            Test connection
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {connection ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
