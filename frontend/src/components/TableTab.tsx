import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Database as DatabaseIcon,
  GitCompare,
  HardDrive,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Star,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { FilterCondition, ForeignKeyInfo, TableData, TableStructure } from "@/lib/types";
import type { TableTabDef } from "@/lib/tabs";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { DataGrid } from "@/components/DataGrid";
import { StructureView } from "@/components/StructureView";
import { AddRowDialog } from "@/components/AddRowDialog";
import { FilterBar } from "@/components/FilterBar";
import { ExportMenu } from "@/components/ExportMenu";
import { CellViewer } from "@/components/CellViewer";
import { PasteRowsDialog } from "@/components/PasteRowsDialog";
import { DataDiffDialog } from "@/components/DataDiffDialog";
import { PasteCellsDialog, type PasteCellChange } from "@/components/PasteCellsDialog";
import { StatsDialog } from "@/components/StatsDialog";
import { RowDetailDrawer } from "@/components/RowDetailDrawer";
import { useFavorites } from "@/lib/favorites";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  tab: TableTabDef;
  onRenamed: (newName: string) => void;
  onDropped: () => void;
  onOpenRef?: (foreignKey: ForeignKeyInfo, value: unknown) => void;
}

const PAGE_SIZES = [50, 100, 200, 500, 1000];

interface TableViewState {
  orderBy: string;
  filters: FilterCondition[];
  quickFilters: Record<string, string>;
  pageSize: number;
}

const tableStateKey = (tab: TableTabRef) =>
  `mysqlui.tableView.${tab.connectionId}:${tab.database}:${tab.table}`;

type TableTabRef = { connectionId: string; database: string; table: string };

function readTableViewState(tab: TableTabRef): TableViewState {
  const fallback: TableViewState = { orderBy: "", filters: [], quickFilters: {}, pageSize: 100 };
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = localStorage.getItem(tableStateKey(tab));
    const stored = raw ? (JSON.parse(raw) as Partial<TableViewState>) : {};
    let filters = Array.isArray(stored.filters) ? stored.filters : [];
    let quickFilters = stored.quickFilters && typeof stored.quickFilters === "object" ? stored.quickFilters : {};
    let orderBy = typeof stored.orderBy === "string" ? stored.orderBy : "";
    if (params.get("orderBy")) orderBy = params.get("orderBy") ?? "";
    if (params.get("filters")) {
      try {
        const parsed = JSON.parse(params.get("filters") ?? "[]") as FilterCondition[];
        if (Array.isArray(parsed)) filters = parsed;
      } catch {
        /* ignore malformed URL */
      }
    }
    if (params.get("quickFilters")) {
      try {
        const parsed = JSON.parse(params.get("quickFilters") ?? "{}") as Record<string, string>;
        if (parsed && typeof parsed === "object") quickFilters = parsed;
      } catch {
        /* ignore malformed URL */
      }
    }
    return {
      orderBy,
      filters,
      quickFilters,
      pageSize: [50, 100, 200, 500, 1000].includes(Number(stored.pageSize)) ? Number(stored.pageSize) : 100,
    };
  } catch {
    return fallback;
  }
}

interface PendingEdit {
  rowIndex: number;
  pk: Record<string, unknown>;
  column: string;
  oldValue: unknown;
  newValue: unknown;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

export function TableTab({ tab, onRenamed, onDropped, onOpenRef }: Props) {
  const [view, setView] = useState<"data" | "structure">("data");
  const [structure, setStructure] = useState<TableStructure | null>(null);
  const [data, setData] = useState<TableData | null>(null);
  const [page, setPage] = useState(0);
  const initialState = readTableViewState(tab);
  const [pageSize, setPageSize] = useState(initialState.pageSize);
  const [orderBy, setOrderBy] = useState(initialState.orderBy);
  const [filters, setFilters] = useState<FilterCondition[]>(initialState.filters);
  const [quickFilters, setQuickFilters] = useState<Record<string, string>>(initialState.quickFilters);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [duplicateRow, setDuplicateRow] = useState<number | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [cellViewer, setCellViewer] = useState<{ open: boolean; rowIndex: number; column: string } | null>(null);
  const [pending, setPending] = useState<PendingEdit[]>([]);
  const [commitBusy, setCommitBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [rowDetail, setRowDetail] = useState<number | null>(null);
  const [pasteCells, setPasteCells] = useState<{
    open: boolean;
    changes: PasteCellChange[];
    invalid: string[];
    start: string;
  } | null>(null);
  const { isFavorite, toggle } = useFavorites();
  const favorite = isFavorite({ kind: "table", connectionId: tab.connectionId, database: tab.database, table: tab.table });

  const loadStructure = useCallback(async () => {
    try {
      const res = await api.tableStructure(tab.connectionId, tab.database, tab.table);
      setStructure(res);
    } catch (err) {
      toast.error("Failed to load table structure", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [tab.connectionId, tab.database, tab.table]);

  const combinedFilters = useMemo<FilterCondition[]>(
    () => [
      ...filters,
      ...Object.entries(quickFilters)
        .filter(([, value]) => value.trim() !== "")
        .map(([column, value]) => ({ column, op: "contains", value })),
    ],
    [filters, quickFilters]
  );

  const loadData = useCallback(
    async (p: number, size: number) => {
      setLoading(true);
      setError(null);
      setPending([]);
      try {
        const res = await api.tableData(
          tab.connectionId,
          tab.database,
          tab.table,
          size,
          p * size,
          orderBy,
          combinedFilters,
          search
        );
        setData({ ...res, primaryKey: res.primaryKey ?? [] });
        setSelected(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [tab.connectionId, tab.database, tab.table, orderBy, combinedFilters, search]
  );

  useEffect(() => {
    const stored = readTableViewState(tab);
    setPage(0);
    setData(null);
    setStructure(null);
    setOrderBy(stored.orderBy);
    setFilters(stored.filters);
    setQuickFilters(stored.quickFilters);
    setPageSize(stored.pageSize);
    setSearch("");
    setSearchDraft("");
    void loadStructure();
  }, [tab.id, loadStructure]);

  useEffect(() => {
    void loadData(page, pageSize);
  }, [page, pageSize, loadData]);

  useEffect(() => {
    const state: TableViewState = { orderBy, filters, quickFilters, pageSize };
    try {
      localStorage.setItem(tableStateKey(tab), JSON.stringify(state));
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams(window.location.search);
    if (orderBy) params.set("orderBy", orderBy);
    else params.delete("orderBy");
    if (filters.length) params.set("filters", JSON.stringify(filters));
    else params.delete("filters");
    if (Object.keys(quickFilters).length) params.set("quickFilters", JSON.stringify(quickFilters));
    else params.delete("quickFilters");
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
  }, [tab, orderBy, filters, quickFilters, pageSize]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { table: string; column: string; value: unknown };
      if (detail?.table !== tab.table) return;
      setFilters([{ column: detail.column, op: "=", value: detail.value }]);
      setPage(0);
    };
    window.addEventListener("mysqlui:applyFilter", handler);
    return () => window.removeEventListener("mysqlui:applyFilter", handler);
  }, [tab.table]);

  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  const toggleSort = (column: string, additive = false) => {
    const entries = orderBy
      .split(",")
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((raw) => ({
        column: raw.startsWith("-") || raw.startsWith("+") ? raw.slice(1) : raw,
        desc: raw.startsWith("-"),
      }));
    const index = entries.findIndex((entry) => entry.column === column);
    let next = entries;
    if (index >= 0) {
      const current = entries[index];
      if (additive) {
        if (!current.desc) {
          next = entries.map((entry, i) => (i === index ? { ...entry, desc: true } : entry));
        } else {
          next = entries.filter((_, i) => i !== index);
        }
      } else if (!current.desc) {
        next = [{ column, desc: true }];
      } else {
        next = [];
      }
    } else if (additive) {
      next = [...entries, { column, desc: false }];
    } else {
      next = [{ column, desc: false }];
    }
    setOrderBy(next.map((entry) => (entry.desc ? `-${entry.column}` : entry.column)).join(","));
    setPage(0);
  };

  const applyFilters = (next: FilterCondition[]) => {
    setFilters(next);
    setPage(0);
  };

  const buildPrimaryKey = (rowIndex: number): Record<string, unknown> | null => {
    if (!data) return null;
    if (data.primaryKey.length === 0) return null;
    const row = data.rows[rowIndex];
    const pk: Record<string, unknown> = {};
    for (const col of data.primaryKey) {
      const idx = data.columns.indexOf(col);
      if (idx === -1) return null;
      pk[col] = row[idx];
    }
    return pk;
  };

  const queueChanges = (changes: PasteCellChange[]) => {
    if (!data || changes.length === 0) return;
    const nextRows = data.rows.map((row) => [...row]);
    const nextPending = [...pending];
    for (const change of changes) {
      const colIndex = data.columns.indexOf(change.column);
      if (change.rowIndex < 0 || change.rowIndex >= nextRows.length || colIndex < 0) continue;
      const existing = nextPending.find((p) => p.rowIndex === change.rowIndex && p.column === change.column);
      const rowPk = nextPending.find((p) => p.rowIndex === change.rowIndex)?.pk;
      const pk = existing?.pk ?? rowPk ?? buildPrimaryKey(change.rowIndex);
      if (!pk) {
        toast.error("Cannot edit", {
          description: "This table has no primary key, so rows cannot be targeted safely.",
        });
        return;
      }
      const oldValue = existing ? existing.oldValue : nextRows[change.rowIndex][colIndex];
      if (existing) nextPending.splice(nextPending.indexOf(existing), 1);
      nextPending.push({
        rowIndex: change.rowIndex,
        pk,
        column: change.column,
        oldValue,
        newValue: change.value,
      });
      nextRows[change.rowIndex][colIndex] = change.value;
    }
    setData((prev) => (prev ? { ...prev, rows: nextRows } : prev));
    setPending(nextPending);
  };

  const handleUpdateCell = async (rowIndex: number, column: string, value: unknown) => {
    queueChanges([{ rowIndex, column, value }]);
  };

  const handlePasteRange = (startRow: number, startColumn: number, matrix: string[][]) => {
    if (!data) return;
    const changes: PasteCellChange[] = [];
    const invalid: string[] = [];
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        const rowIndex = startRow + r;
        const colIndex = startColumn + c;
        const column = data.columns[colIndex];
        if (!column || rowIndex >= data.rows.length) {
          invalid.push(`row ${rowIndex + 1}, column ${colIndex + 1} is outside the current page`);
          continue;
        }
        const raw = matrix[r][c];
        const meta = columnsMeta.find((m) => m.name === column);
        const value = raw.toUpperCase() === "NULL" ? null : raw === "" && meta?.nullable ? null : raw;
        changes.push({ rowIndex, column, value });
      }
    }
    setPasteCells({
      open: true,
      changes,
      invalid,
      start: `row ${startRow + 1}, column ${data.columns[startColumn] ?? startColumn + 1}`,
    });
  };

  const rollbackPending = () => {
    if (!data || pending.length === 0) return;
    const rows = data.rows.map((row) => [...row]);
    for (const edit of pending) {
      const colIndex = data.columns.indexOf(edit.column);
      if (colIndex >= 0 && rows[edit.rowIndex]) rows[edit.rowIndex][colIndex] = edit.oldValue;
    }
    setData((prev) => (prev ? { ...prev, rows } : prev));
    setPending([]);
    toast.info("Pending changes rolled back");
  };

  const commitPending = async () => {
    if (pending.length === 0) return;
    const groups = new Map<string, { data: Record<string, unknown>; primaryKey: Record<string, unknown> }>();
    for (const edit of pending) {
      const key = JSON.stringify(edit.pk);
      const group = groups.get(key) ?? { data: {}, primaryKey: edit.pk };
      group.data[edit.column] = edit.newValue;
      groups.set(key, group);
    }
    setCommitBusy(true);
    try {
      const res = await api.bulkUpdateRows(
        tab.connectionId,
        tab.database,
        tab.table,
        Array.from(groups.values())
      );
      toast.success(`Committed ${res.updated} row(s) in one transaction`);
      setPending([]);
      await loadData(page, pageSize);
    } catch (err) {
      toast.error("Batch update rolled back", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCommitBusy(false);
    }
  };

  const pendingPreviewSQL = () => {
    const groups = new Map<string, { data: Record<string, unknown>; primaryKey: Record<string, unknown> }>();
    for (const edit of pending) {
      const key = JSON.stringify(edit.pk);
      const group = groups.get(key) ?? { data: {}, primaryKey: edit.pk };
      group.data[edit.column] = edit.newValue;
      groups.set(key, group);
    }
    return Array.from(groups.values()).map((group) => {
      const sets = Object.entries(group.data)
        .map(([column, value]) => `\`${column}\` = ${sqlValue(value)}`)
        .join(", ");
      const where = Object.entries(group.primaryKey)
        .map(([column, value]) => `\`${column}\` = ${sqlValue(value)}`)
        .join(" AND ");
      return `UPDATE \`${tab.table}\` SET ${sets} WHERE ${where};`;
    });
  };

  const confirmDelete = async () => {
    if (deleteTarget === null || !data) return;
    const pk = buildPrimaryKey(deleteTarget);
    if (!pk) {
      toast.error("Cannot delete", { description: "Table has no primary key." });
      setDeleteTarget(null);
      return;
    }
    try {
      await api.deleteRow(tab.connectionId, tab.database, tab.table, pk);
      toast.success("Row deleted");
      setDeleteTarget(null);
      if (data.rows.length === 1 && page > 0) setPage((p) => p - 1);
      else void loadData(page, pageSize);
    } catch (err) {
      toast.error("Delete failed", { description: err instanceof Error ? err.message : String(err) });
      setDeleteTarget(null);
    }
  };

  const confirmBulkDelete = async () => {
    if (!data || selected.size === 0) return;
    if (data.primaryKey.length === 0) {
      toast.error("Cannot delete", {
        description: "This table has no primary key, so rows cannot be targeted safely.",
      });
      setBulkOpen(false);
      return;
    }
    const keys: Record<string, unknown>[] = [];
    for (const index of selected) {
      const pk = buildPrimaryKey(index);
      if (!pk) {
        toast.error("Cannot delete", { description: "Some selected rows could not be identified." });
        setBulkOpen(false);
        return;
      }
      keys.push(pk);
    }
    setBulkBusy(true);
    try {
      const res = await api.bulkDeleteRows(tab.connectionId, tab.database, tab.table, keys);
      toast.success(`Deleted ${res.affected} row(s)`);
      setSelected(new Set());
      setBulkOpen(false);
      if (data.rows.length === selected.size && page > 0) setPage((p) => p - 1);
      else void loadData(page, pageSize);
    } catch (err) {
      toast.error("Delete failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleInsert = async (values: Record<string, unknown>) => {
    try {
      await api.insertRow(tab.connectionId, tab.database, tab.table, values);
      toast.success(duplicateRow !== null ? "Row duplicated" : "Row inserted");
      setDuplicateRow(null);
      void loadData(page, pageSize);
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  };

  const columnsMeta = structure?.columns ?? [];
  const filterColumns = columnsMeta.length ? columnsMeta.map((c) => c.name) : data?.columns ?? [];
  const duplicateValues = (() => {
    if (duplicateRow === null || !data) return undefined;
    const values: Record<string, unknown> = {};
    for (const col of columnsMeta) {
      if (/auto_increment|default_generated/i.test(col.extra)) continue;
      const idx = data.columns.indexOf(col.name);
      if (idx >= 0) values[col.name] = data.rows[duplicateRow][idx];
    }
    return values;
  })();

  const refreshAll = () => {
    void loadStructure();
    void loadData(page, pageSize);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Table2 className="h-4 w-4 text-emerald-400" />
        <span className="font-mono text-sm font-medium">{tab.table}</span>
        <Button
          size="icon-sm"
          variant="ghost"
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() =>
            toggle({
              kind: "table",
              connectionId: tab.connectionId,
              connectionName: tab.connectionName,
              database: tab.database,
              table: tab.table,
            })
          }
        >
          <Star className={favorite ? "fill-amber-400 text-amber-400" : undefined} />
        </Button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <DatabaseIcon className="h-3 w-3" />
          {tab.database}
        </span>
        <Badge variant="outline" className="font-normal">
          {tab.connectionName}
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as "data" | "structure")}>
            <TabsList className="h-8">
              <TabsTrigger value="data" className="gap-1.5 px-3 text-xs">
                <Table2 className="h-3.5 w-3.5" /> Data
              </TabsTrigger>
              <TabsTrigger value="structure" className="gap-1.5 px-3 text-xs">
                <Layers className="h-3.5 w-3.5" /> Structure
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {view === "data" && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-1.5 text-xs">
          <Button size="sm" variant="outline" disabled={!structure} onClick={() => { setDuplicateRow(null); setAddOpen(true); }}>
            <Plus /> Insert row
          </Button>
          <Button size="sm" variant="outline" disabled={!structure || !data} onClick={() => setPasteOpen(true)}>
            <ClipboardPaste /> Paste rows
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDiffOpen(true)}>
            <GitCompare /> Compare
          </Button>
          <Button size="sm" variant="outline" onClick={() => setStatsOpen(true)}>
            <HardDrive /> Stats
          </Button>
          <Button size="sm" variant="outline" onClick={() => void loadData(page, pageSize)} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
          </Button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-7 w-[180px] pl-7 text-xs"
              placeholder="Search all columns"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSearch(searchDraft.trim());
                  setPage(0);
                }
              }}
            />
          </div>
          <FilterBar columns={filterColumns} filters={filters} onApply={applyFilters} />
          <ExportMenu
            connectionId={tab.connectionId}
            database={tab.database}
            table={tab.table}
            orderBy={orderBy || undefined}
            filters={combinedFilters}
          />

          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">
              {formatNumber(start)}–{formatNumber(end)} of {formatNumber(total)}
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-7 w-[90px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="outline" disabled={page <= 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft />
              </Button>
              <span className="tabular-nums text-muted-foreground">
                {page + 1} / {maxPage + 1}
              </span>
              <Button size="icon-sm" variant="outline" disabled={page >= maxPage || loading} onClick={() => setPage((p) => Math.min(maxPage, p + 1))}>
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {view === "structure" ? (
          structure ? (
            <StructureView
              structure={structure}
              connectionId={tab.connectionId}
              database={tab.database}
              table={tab.table}
              onRefresh={refreshAll}
              onRenamed={onRenamed}
              onDropped={onDropped}
            />
          ) : (
            <Centered>
              <Loader2 className="h-5 w-5 animate-spin" />
            </Centered>
          )
        ) : error ? (
          <Centered>
            <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          </Centered>
        ) : data ? (
          <DataGrid
            columns={data.columns}
            rows={data.rows}
            columnsMeta={columnsMeta}
            primaryKey={data.primaryKey}
            foreignKeys={structure?.foreignKeys ?? []}
            tableName={tab.table}
            storageKey={`${tab.connectionId}:${tab.database}:${tab.table}`}
            orderBy={orderBy}
            onSort={toggleSort}
            quickFilters={quickFilters}
            onQuickFiltersChange={(next) => {
              setQuickFilters(next);
              setPage(0);
            }}
            onUpdateCell={handleUpdateCell}
            onDeleteRow={(r) => setDeleteTarget(r)}
            onDuplicateRow={(r) => { setDuplicateRow(r); setAddOpen(true); }}
            onViewCell={(r, column) => setCellViewer({ open: true, rowIndex: r, column })}
            onRowDetail={(r) => setRowDetail(r)}
            onJump={(fk, value) => onOpenRef?.(fk, value)}
            onPasteRange={handlePasteRange}
            selected={selected}
            onSelectedChange={setSelected}
          />
        ) : (
          <Centered>
            <Loader2 className="h-5 w-5 animate-spin" />
          </Centered>
        )}
        {loading && data && (
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-md border bg-card/90 px-2 py-1 text-xs shadow">
            <Loader2 className="h-3 w-3 animate-spin" /> loading…
          </div>
        )}
        {view === "data" && pending.length > 0 && (
          <div className="absolute bottom-3 left-3 right-3 z-30 flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-card/95 px-3 py-2 text-sm shadow-lg">
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {pending.length} pending change(s)
            </span>
            <span className="text-xs text-muted-foreground">Nothing has been written yet.</span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
                Preview SQL
              </Button>
              <Button size="sm" variant="outline" onClick={rollbackPending} disabled={commitBusy}>
                Rollback
              </Button>
              <Button size="sm" onClick={() => void commitPending()} disabled={commitBusy}>
                {commitBusy ? <Loader2 className="animate-spin" /> : null} Commit all
              </Button>
            </div>
          </div>
        )}
        {view === "data" && selected.size > 0 && (
          <div className="absolute left-3 top-3 z-30 flex items-center gap-3 rounded-md border bg-card/95 px-3 py-1.5 text-sm shadow-lg">
            <span className="text-muted-foreground">{selected.size} selected</span>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkBusy || data?.primaryKey.length === 0}
              title={data?.primaryKey.length === 0 ? "Table has no primary key" : undefined}
              onClick={() => setBulkOpen(true)}
            >
              {bulkBusy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete selected
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X /> Clear
            </Button>
          </div>
        )}
      </div>

      <AddRowDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setDuplicateRow(null);
        }}
        columns={columnsMeta}
        initialValues={duplicateValues}
        onSubmit={handleInsert}
      />
      <DataDiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        connectionId={tab.connectionId}
        database={tab.database}
        table={tab.table}
      />
      {pasteCells && (
        <PasteCellsDialog
          open={pasteCells.open}
          onOpenChange={(open) => setPasteCells((prev) => (prev ? { ...prev, open } : prev))}
          changes={pasteCells.changes}
          invalid={pasteCells.invalid}
          start={pasteCells.start}
          onApply={() => {
            queueChanges(pasteCells.changes);
            setPasteCells(null);
            toast.success(`Added ${pasteCells.changes.length} cell change(s) to the pending batch`);
          }}
        />
      )}
      <RowDetailDrawer
        open={rowDetail !== null && Boolean(data)}
        onOpenChange={(open) => !open && setRowDetail(null)}
        row={rowDetail !== null ? data?.rows[rowDetail] ?? null : null}
        rowIndex={rowDetail ?? 0}
        columns={data?.columns ?? []}
        columnsMeta={columnsMeta}
        foreignKeys={structure?.foreignKeys ?? []}
        onUpdateCell={handleUpdateCell}
        onViewCell={(r, column) => {
          setRowDetail(null);
          setCellViewer({ open: true, rowIndex: r, column });
        }}
        onJump={(fk, value) => {
          setRowDetail(null);
          onOpenRef?.(fk, value);
        }}
      />

      <StatsDialog
        open={statsOpen}
        onOpenChange={setStatsOpen}
        connectionId={tab.connectionId}
        database={tab.database}
        table={tab.table}
      />
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pending batch preview</DialogTitle>
            <DialogDescription>
              {pending.length} change(s) will run in a single transaction. A failure rolls back the whole batch.
            </DialogDescription>
          </DialogHeader>
          <pre className="scrollbar-thin max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[12px]">
            {pendingPreviewSQL().join("\n")}
          </pre>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            <Button onClick={() => { setPreviewOpen(false); void commitPending(); }} disabled={commitBusy}>
              Commit all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PasteRowsDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        columns={data?.columns ?? []}
        onSubmit={async (columns, rows) => {
          const res = await api.bulkInsertRows(tab.connectionId, tab.database, tab.table, columns, rows as unknown[][]);
          toast.success(`Inserted ${res.affected} row(s)`);
          await loadData(page, pageSize);
        }}
      />

      {cellViewer && (
        <CellViewer
          open={cellViewer.open}
          onOpenChange={(o) => !o && setCellViewer(null)}
          connectionId={tab.connectionId}
          database={tab.database}
          table={tab.table}
          column={cellViewer.column}
          primaryKey={buildPrimaryKey(cellViewer.rowIndex)}
          initialValue={data?.rows[cellViewer.rowIndex]?.[data.columns.indexOf(cellViewer.column)]}
          editable
          onSave={async (value) => {
            await handleUpdateCell(cellViewer.rowIndex, cellViewer.column, value);
          }}
        />
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" /> Delete this row?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the row from{" "}
              <span className="font-mono">
                {tab.database}.{tab.table}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" /> Delete {selected.size} row(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected rows from{" "}
              <span className="font-mono">
                {tab.database}.{tab.table}
              </span>{" "}
              in a single transaction. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkBusy}
              onClick={(e) => {
                e.preventDefault();
                void confirmBulkDelete();
              }}
            >
              {bulkBusy ? <Loader2 className="animate-spin" /> : null} Delete {selected.size}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center text-muted-foreground">{children}</div>;
}
