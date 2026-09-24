import { useEffect, useMemo, useState } from "react";
import { Hammer, Play, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import type { TableInfo, TableStructure } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Condition {
  column: string;
  op: string;
  value: string;
}

interface Props {
  connectionId: string;
  database: string;
  onApply: (sql: string) => void;
}

const OPS = ["=", "!=", ">", ">=", "<", "<=", "LIKE", "IN", "IS NULL", "IS NOT NULL"];

export function QueryBuilder({ connectionId, database, onApply }: Props) {
  const { t } = useI18n();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [table, setTable] = useState("");
  const [structure, setStructure] = useState<TableStructure | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [orderBy, setOrderBy] = useState("");
  const [orderDir, setOrderDir] = useState("ASC");
  const [limit, setLimit] = useState("100");

  useEffect(() => {
    if (!database) return;
    api.listTables(connectionId, database).then(setTables).catch(() => setTables([]));
  }, [connectionId, database]);

  useEffect(() => {
    if (!table) {
      setStructure(null);
      setSelected([]);
      setConditions([]);
      return;
    }
    api.tableStructure(connectionId, database, table).then((s) => {
      setStructure(s);
      setSelected([]);
      setConditions([]);
    });
  }, [connectionId, database, table]);

  const sql = useMemo(() => {
    if (!table || !structure) return "";
    const cols = selected.length ? selected.map((c) => `\`${c}\``).join(", ") : "*";
    let q = `SELECT ${cols}\nFROM \`${database}\`.\`${table}\``;
    const clauses = conditions.filter((c) => c.column);
    if (clauses.length) {
      const parts = clauses.map((c) => {
        if (c.op === "IS NULL" || c.op === "IS NOT NULL") return `\`${c.column}\` ${c.op}`;
        if (c.op === "IN") return `\`${c.column}\` IN (${c.value})`;
        if (c.op === "LIKE") return `\`${c.column}\` LIKE ${quote(c.value)}`;
        return `\`${c.column}\` ${c.op} ${quote(c.value)}`;
      });
      q += "\nWHERE " + parts.join("\n  AND ");
    }
    if (orderBy) q += `\nORDER BY \`${orderBy}\` ${orderDir}`;
    if (limit) q += `\nLIMIT ${Number(limit) || 100}`;
    return q + ";";
  }, [table, structure, selected, conditions, orderBy, orderDir, limit, database]);

  const columns = structure?.columns ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Hammer className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t("qb.title", "Query builder")}</span>
        <span className="font-mono text-xs text-muted-foreground">{database}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-auto p-4">
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("qb.table", "Table")}</Label>
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {tables.map((tb) => (
                  <SelectItem key={tb.name} value={tb.name}>
                    {tb.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">{t("qb.columns", "Columns (none = *)")}</Label>
            <div className="grid max-h-48 grid-cols-2 gap-1 overflow-auto rounded-md border p-2 text-xs">
              {columns.map((c) => (
                <label key={c.name} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={selected.includes(c.name)}
                    onChange={(e) =>
                      setSelected((s) => (e.target.checked ? [...s, c.name] : s.filter((x) => x !== c.name)))
                    }
                  />
                  <span className="truncate font-mono">{c.name}</span>
                </label>
              ))}
              {columns.length === 0 && <span className="text-muted-foreground">—</span>}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">{t("qb.where", "Conditions")}</Label>
            <div className="space-y-2">
              {conditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Select
                    value={cond.column}
                    onValueChange={(v) => setConditions((cs) => cs.map((c, k) => (k === i ? { ...c, column: v } : c)))}
                  >
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue placeholder="col" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => (
                        <SelectItem key={c.name} value={c.name}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={cond.op}
                    onValueChange={(v) => setConditions((cs) => cs.map((c, k) => (k === i ? { ...c, op: v } : c)))}
                  >
                    <SelectTrigger className="h-8 w-[110px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-8 flex-1 text-xs"
                    disabled={cond.op === "IS NULL" || cond.op === "IS NOT NULL"}
                    value={cond.value}
                    onChange={(e) => setConditions((cs) => cs.map((c, k) => (k === i ? { ...c, value: e.target.value } : c)))}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setConditions((cs) => cs.filter((_, k) => k !== i))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                disabled={!table}
                onClick={() => setConditions((cs) => [...cs, { column: columns[0]?.name ?? "", op: "=", value: "" }])}
              >
                <Plus /> {t("qb.addCondition", "Add condition")}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("qb.orderBy", "Order by")}</Label>
              <Select value={orderBy} onValueChange={setOrderBy}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">ASC/DESC</Label>
              <Select value={orderDir} onValueChange={setOrderDir}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASC">ASC</SelectItem>
                  <SelectItem value="DESC">DESC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("qb.limit", "Limit")}</Label>
              <Input className="h-8 text-xs" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-xs">{t("qb.generate", "Generated SQL")}</Label>
            <Button size="sm" disabled={!sql} onClick={() => onApply(sql)}>
              <Play /> {t("qb.apply", "Use in editor")}
            </Button>
          </div>
          <pre
            className={cn(
              "scrollbar-thin min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-[12px] leading-relaxed",
              !sql && "text-muted-foreground"
            )}
          >
            {sql || t("qb.table", "Pick a table to build a query")}
          </pre>
        </div>
      </div>
    </div>
  );
}

function quote(v: string): string {
  if (v === "") return "''";
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return "'" + v.replace(/'/g, "\\'") + "'";
}
