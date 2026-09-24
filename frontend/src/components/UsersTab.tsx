import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { UserInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const PRIVILEGES = [
  "SELECT","INSERT","UPDATE","DELETE","CREATE","DROP","ALTER","INDEX","REFERENCES","CREATE VIEW",
  "SHOW VIEW","TRIGGER","EXECUTE","EVENT","LOCK TABLES","CREATE ROUTINE","ALTER ROUTINE",
  "CREATE TEMPORARY TABLES","CREATE USER","PROCESS","SHOW DATABASES","ALL PRIVILEGES",
];

interface Props {
  connectionId: string;
}

export function UsersTab({ connectionId }: Props) {
  const { t } = useI18n();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<UserInfo | null>(null);
  const [grants, setGrants] = useState<string[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<UserInfo | null>(null);

  const [newUser, setNewUser] = useState({ user: "", host: "%", password: "" });
  const [grantForm, setGrantForm] = useState({
    privileges: [] as string[],
    database: "",
    table: "",
    withGrantOption: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.listUsers(connectionId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadGrants = useCallback(
    async (u: UserInfo) => {
      setSelected(u);
      setGrantsLoading(true);
      try {
        setGrants(await api.userGrants(connectionId, u.host, u.user));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        setGrants([]);
      } finally {
        setGrantsLoading(false);
      }
    },
    [connectionId]
  );

  const submitCreate = async () => {
    if (!newUser.user.trim()) {
      toast.error(t("users.user", "User") + " ?");
      return;
    }
    try {
      await api.createUser(connectionId, newUser);
      toast.success(t("users.create", "Create user"));
      setCreateOpen(false);
      setNewUser({ user: "", host: "%", password: "" });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const submitGrant = async () => {
    if (!selected) return;
    if (grantForm.privileges.length === 0) {
      toast.error(t("users.privileges", "Privileges"));
      return;
    }
    try {
      await api.grant(connectionId, selected.host, selected.user, grantForm);
      toast.success(t("users.grant", "Grant"));
      setGrantOpen(false);
      void loadGrants(selected);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDrop = async () => {
    if (!dropTarget) return;
    try {
      await api.dropUser(connectionId, dropTarget.host, dropTarget.user);
      toast.success(t("users.drop", "Drop user"));
      if (selected?.user === dropTarget.user && selected?.host === dropTarget.host) {
        setSelected(null);
        setGrants([]);
      }
      setDropTarget(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setDropTarget(null);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-1/2 min-w-[320px] flex-col border-r">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{t("users.title", "Users")}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <UserPlus /> {t("users.create", "New user")}
            </Button>
          </div>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("users.user", "User")}</th>
                <th className="px-3 py-2 font-medium">{t("users.host", "Host")}</th>
                <th className="px-3 py-2 font-medium">{t("users.plugin", "Plugin")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={`${u.user}@${u.host}`}
                  className={
                    "cursor-pointer border-t hover:bg-muted/40 " +
                    (selected?.user === u.user && selected?.host === u.host ? "bg-muted/60" : "")
                  }
                  onClick={() => void loadGrants(u)}
                >
                  <td className="px-3 py-1.5 font-mono">{u.user}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{u.host}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{u.plugin}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDropTarget(u);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium">{t("users.grants", "Privileges")}</span>
          {selected && (
            <Badge variant="outline" className="font-mono">
              {selected.user}@{selected.host}
            </Badge>
          )}
          <div className="ml-auto">
            <Button size="sm" variant="outline" disabled={!selected} onClick={() => setGrantOpen(true)}>
              <Plus /> {t("users.grant", "Grant")}
            </Button>
          </div>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
          {grantsLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !selected ? (
            <p className="pt-10 text-center text-sm text-muted-foreground">
              {t("users.grantsFor", "Select a user to view privileges")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {grants.map((g, i) => (
                <div key={i} className="rounded-md border bg-muted/20 px-3 py-2 font-mono text-[12px]">
                  {g}
                </div>
              ))}
              {grants.length === 0 && (
                <p className="pt-10 text-center text-sm text-muted-foreground">{t("common.empty", "No content")}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" /> {t("users.create", "New user")}
            </DialogTitle>
            <DialogDescription>CREATE USER 'user'@'host' IDENTIFIED BY '…'</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("users.user", "User")}</Label>
              <Input
                className="h-8 font-mono"
                value={newUser.user}
                onChange={(e) => setNewUser((s) => ({ ...s, user: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("users.host", "Host")}</Label>
              <Input
                className="h-8 font-mono"
                value={newUser.host}
                onChange={(e) => setNewUser((s) => ({ ...s, host: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("users.newPassword", "Password")}</Label>
              <Input
                type="password"
                className="h-8 font-mono"
                value={newUser.password}
                onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={submitCreate}>
              <KeyRound /> {t("common.save", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("users.grant", "Grant")} — {selected?.user}@{selected?.host}
            </DialogTitle>
            <DialogDescription>GRANT … ON database.table TO user</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("users.privileges", "Privileges")}</Label>
              <div className="grid max-h-40 grid-cols-2 gap-1 overflow-auto rounded-md border p-2 text-xs">
                {PRIVILEGES.map((p) => (
                  <label key={p} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={grantForm.privileges.includes(p)}
                      onChange={(e) =>
                        setGrantForm((s) => ({
                          ...s,
                          privileges: e.target.checked
                            ? [...s.privileges, p]
                            : s.privileges.filter((x) => x !== p),
                        }))
                      }
                    />
                    <span className="font-mono">{p}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("users.database", "Database")}</Label>
                <Input
                  className="h-8 font-mono"
                  placeholder="*"
                  value={grantForm.database}
                  onChange={(e) => setGrantForm((s) => ({ ...s, database: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("users.table", "Table")}</Label>
                <Input
                  className="h-8 font-mono"
                  placeholder="*"
                  value={grantForm.table}
                  onChange={(e) => setGrantForm((s) => ({ ...s, table: e.target.value }))}
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="accent-primary"
                checked={grantForm.withGrantOption}
                onChange={(e) => setGrantForm((s) => ({ ...s, withGrantOption: e.target.checked }))}
              />
              WITH GRANT OPTION
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={submitGrant}>
              <ShieldCheck /> {t("users.grant", "Grant")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dropTarget !== null} onOpenChange={(o) => !o && setDropTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" /> {t("users.drop", "Drop user")}
            </AlertDialogTitle>
            <AlertDialogDescription className="font-mono">
              {dropTarget?.user}@{dropTarget?.host}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDrop}
            >
              {t("common.delete", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
