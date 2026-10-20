import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { PrivilegeMatrix, PrivilegeMatrixUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
}

const SHORT: Record<string, string> = {
  SELECT: "S", INSERT: "I", UPDATE: "U", DELETE: "D", CREATE: "C", DROP: "D", ALTER: "A",
  INDEX: "X", REFERENCES: "R", "CREATE VIEW": "V", "SHOW VIEW": "W", TRIGGER: "T",
  EXECUTE: "E", EVENT: "N", "GRANT OPTION": "G",
};

export function PrivilegeMatrixDialog({ open, onOpenChange, connectionId }: Props) {
  const [matrix, setMatrix] = useState<PrivilegeMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMatrix(await api.privilegeMatrix(connectionId));
    } catch (err) {
      toast.error("Could not load privilege matrix", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const databases = matrix?.databases ?? [];
  const flags = (matrix?.flags ?? []).filter((f) => f !== "GRANT OPTION");
  const users = useMemo(
    () => (matrix?.users ?? []).filter((u) => !filter || `${u.user}@${u.host}`.toLowerCase().includes(filter.toLowerCase())),
    [matrix, filter]
  );

  const toggle = async (
    user: PrivilegeMatrixUser,
    database: string,
    flag: string,
    checked: boolean
  ) => {
    const key = `${user.user}@${user.host}:${database}:${flag}`;
    setSaving(key);
    try {
      if (checked) {
        await api.grant(connectionId, user.host, user.user, {
          privileges: [flag],
          database: database === "*" ? "" : database,
          table: "",
          withGrantOption: false,
        });
      } else {
        await api.revoke(connectionId, user.host, user.user, {
          privileges: [flag],
          database: database === "*" ? "" : database,
          table: "",
        });
      }
      await load();
    } catch (err) {
      toast.error("Privilege change failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" /> Privilege matrix
          </DialogTitle>
          <DialogDescription>
            Users × databases. Click a cell to grant or revoke privileges. “global” cells inherit *.* privileges to every database.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-[220px] text-xs"
            placeholder="Filter users"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {Object.entries(SHORT).map(([flag, short]) => (
              <span key={flag}>
                <b className="text-foreground">{short}</b>={flag}
              </span>
            ))}
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
          </Button>
        </div>
        <div className="scrollbar-thin max-h-[62vh] overflow-auto rounded-md border">
          <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 min-w-[170px] border-b border-r bg-card px-2 py-2 text-left font-medium">User</th>
                <th className="min-w-[110px] border-b border-r bg-card px-2 py-2 text-left font-medium">global *.*</th>
                {databases.map((db) => (
                  <th key={db} className="min-w-[110px] border-b border-r bg-card px-2 py-2 text-left font-medium">
                    {db}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={`${user.user}@${user.host}`} className="hover:bg-muted/30">
                  <td className="sticky left-0 z-10 border-b border-r bg-card px-2 py-1.5 font-mono">
                    {user.user}
                    <span className="text-muted-foreground">@{user.host}</span>
                  </td>
                  <MatrixCell
                    user={user}
                    database="*"
                    flags={flags}
                    active={user.global}
                    inherited={false}
                    tableCount={0}
                    saving={saving}
                    onToggle={(flag, checked) => void toggle(user, "*", flag, checked)}
                  />
                  {databases.map((db) => {
                    const entry = user.databases[db];
                    return (
                      <MatrixCell
                        key={db}
                        user={user}
                        database={db}
                        flags={flags}
                        active={entry?.flags ?? {}}
                        inherited={Boolean(entry?.inherited)}
                        tableCount={entry?.tables.length ?? 0}
                        saving={saving}
                        onToggle={(flag, checked) => void toggle(user, db, flag, checked)}
                      />
                    );
                  })}
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={databases.length + 2} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MatrixCell({
  user,
  database,
  flags,
  active,
  inherited,
  tableCount,
  saving,
  onToggle,
}: {
  user: PrivilegeMatrixUser;
  database: string;
  flags: string[];
  active: Record<string, boolean>;
  inherited: boolean;
  tableCount: number;
  saving: string | null;
  onToggle: (flag: string, checked: boolean) => void;
}) {
  const enabled = flags.filter((flag) => {
    if (active[flag]) return true;
    return inherited && Boolean(user.global[flag]);
  });
  const cellKey = `${user.user}@${user.host}:${database}`;
  return (
    <td className="border-b border-r px-1 py-1 align-middle">
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex min-h-7 w-full flex-wrap items-center gap-0.5 rounded px-1 py-0.5 text-left hover:bg-muted",
              inherited && "bg-sky-500/5"
            )}
            title={inherited ? "Inherited from global privileges" : "Click to edit privileges"}
          >
            {enabled.length === 0 ? (
              <span className="text-muted-foreground/40">—</span>
            ) : (
              enabled.map((flag) => (
                <span
                  key={flag}
                  className={cn(
                    "rounded px-1 font-mono text-[10px]",
                    inherited && !active[flag] ? "bg-sky-500/15 text-sky-500" : "bg-muted text-foreground"
                  )}
                >
                  {SHORT[flag] ?? flag[0]}
                </span>
              ))
            )}
            {inherited && <span className="ml-0.5 text-[9px] uppercase text-sky-500">global</span>}
            {tableCount > 0 && <Badge variant="secondary" className="px-1 py-0 text-[9px]">{tableCount}t</Badge>}
            {saving === `${cellKey}:${flags[0]}` && <Loader2 className="h-3 w-3 animate-spin" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <div className="mb-2 text-xs font-medium">
            {user.user}@{user.host} · {database === "*" ? "global *.*" : database}
          </div>
          {inherited && (
            <p className="mb-2 rounded bg-sky-500/10 p-1.5 text-[10px] text-sky-600 dark:text-sky-400">
              Highlighted flags are inherited from global grants. Grant or revoke at the global cell to change them for every database.
            </p>
          )}
          <div className="grid max-h-64 grid-cols-2 gap-1 overflow-auto">
            {flags.map((flag) => {
              const own = Boolean(active[flag]);
              const inheritedOn = inherited && Boolean(user.global[flag]);
              return (
                <label key={flag} className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                  <Checkbox
                    checked={own || inheritedOn}
                    disabled={inheritedOn && database !== "*"}
                    onCheckedChange={(checked) => {
                      if (!inheritedOn) onToggle(flag, Boolean(checked));
                    }}
                  />
                  <span className="font-mono">{flag}</span>
                </label>
              );
            })}
          </div>
          {database !== "*" && (user.databases[database]?.tables.length ?? 0) > 0 && (
            <div className="mt-2 border-t pt-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Table-level grants</div>
              <div className="max-h-28 space-y-1 overflow-auto">
                {user.databases[database].tables.map((table) => (
                  <div key={table.table} className="flex flex-wrap items-center gap-1 text-[10px]">
                    <span className="font-mono">{table.table}</span>
                    {Object.keys(table.flags).filter((f) => f !== "GRANT OPTION").map((flag) => (
                      <span key={flag} className="rounded bg-muted px-1 font-mono">{SHORT[flag] ?? flag[0]}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </td>
  );
}
