import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Database, Loader2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Connection } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: Connection[];
  initialConnectionId?: string;
  onCreated: (connection: Connection, database: string) => void;
}

export function CreateDatabaseDialog({ open, onOpenChange, connections, initialConnectionId, onCreated }: Props) {
  const { t } = useI18n();
  const [connectionId, setConnectionId] = useState("");
  const [name, setName] = useState("");
  const [charset, setCharset] = useState("utf8mb4");
  const [collation, setCollation] = useState("utf8mb4_unicode_ci");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setCharset("utf8mb4");
    setCollation("utf8mb4_unicode_ci");
    setBusy(false);
    setConnectionId(initialConnectionId || connections[0]?.id || "");
  }, [open, initialConnectionId, connections]);

  const submit = async () => {
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) {
      toast.error(t("db.connectionRequired", "Choose a connection"));
      return;
    }
    if (!name.trim()) {
      toast.error(t("db.nameRequired", "Database name is required"));
      return;
    }
    setBusy(true);
    try {
      await api.createDatabase(conn.id, name.trim(), charset.trim(), collation.trim());
      toast.success(t("db.created", "Database {name} created", { name: name.trim() }));
      onCreated(conn, name.trim());
      onOpenChange(false);
    } catch (err) {
      toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" /> {t("db.create", "New database")}
          </DialogTitle>
          <DialogDescription>
            {t("db.createDesc", "Create a database on the selected MySQL/MariaDB server.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("db.connection", "Connection")}</Label>
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={t("db.connection", "Connection")} />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.host}:{c.port}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-db-name" className="text-xs">
              {t("db.name", "Database name")}
            </Label>
            <Input
              id="new-db-name"
              autoFocus
              className="h-9 font-mono"
              placeholder="mydb"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) void submit();
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("db.nameHint", "Letters, numbers, _ and $ only.")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="new-db-charset" className="text-xs">
                {t("db.charset", "Character set")}
              </Label>
              <Input
                id="new-db-charset"
                className="h-9 font-mono"
                value={charset}
                onChange={(e) => setCharset(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-db-collation" className="text-xs">
                {t("db.collation", "Collation")}
              </Label>
              <Input
                id="new-db-collation"
                className="h-9 font-mono"
                value={collation}
                onChange={(e) => setCollation(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("db.charsetHint", "Defaults to utf8mb4 / utf8mb4_unicode_ci.")}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim() || !connectionId}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("db.create", "New database")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
