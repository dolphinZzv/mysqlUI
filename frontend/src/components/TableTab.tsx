import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Database as DatabaseIcon,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { FilterCondition, ForeignKeyInfo, TableData, TableStructure } from "@/lib/types";
import type { TableTabDef } from "@/lib/tabs";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

interface Props {
  tab: TableTabDef;
  onRenamed: (newName: string) => void;
  onDropped: () => void;
  onOpenRef?: (foreignKey: ForeignKeyInfo, value: unknown) => void;
}

const PAGE_SIZES = [50, 100, 200, 500, 1000];

export function TableTab({ tab, onRenamed, onDropped, onOpenRef }: Props) {
  const [view, setView] = useState<"data" | "structure">("data");
  const [structure, setStructure] = useState<TableStructure | null>(null);
  const [data, setData] = useState<TableData | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [orderBy, setOrderBy] = useState("");
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [cellViewer, setCellViewer] = useState<{ open: boolean; rowIndex: number; column: string } | null>(null);

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

  const loadData = useCallback(
    async (p: number, size: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.tableData(
          tab.connectionId,
          tab.database,
          tab.table,
          size,
          p * size,
          orderBy,
          filters
        );
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [tab.connectionId, tab.database, tab.table, orderBy, filters]
  );

  useEffect(() => {
    setPage(0);
    setData(null);
    setStructure(null);
    setOrderBy("");
    setFilters([]);
    void loadStructure();
  }, [tab.id, loadStructure]);

  useEffect(() => {
    void loadData(page, pageSize);
  }, [page, pageSize, loadData]);

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

  const toggleSort = (column: string) => {
    setOrderBy((prev) => (prev === column ? `-${column}` : prev === `-${column}` ? "" : column));
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

  const handleUpdateCell = async (rowIndex: number, column: string, value: unknown) => {
    const pk = buildPrimaryKey(rowIndex);
    if (!pk) {
      toast.error("Cannot edit", {
        description: "This table has no primary key, so rows cannot be targeted safely.",
      });
      throw new Error("no primary key");
    }
    await api.updateRow(tab.connectionId, tab.database, tab.table, { [column]: value }, pk);
    setData((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((r, i) =>
        i === rowIndex ? r.map((c, j) => (prev.columns[j] === column ? value : c)) : r
      );
      return { ...prev, rows };
    });
    toast.success(`Updated "${column}"`);
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

  const handleInsert = async (values: Record<string, unknown>) => {
    try {
      await api.insertRow(tab.connectionId, tab.database, tab.table, values);
      toast.success("Row inserted");
      void loadData(page, pageSize);
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  };

  const columnsMeta = structure?.columns ?? [];
  const filterColumns = columnsMeta.length ? columnsMeta.map((c) => c.name) : data?.columns ?? [];

  const refreshAll = () => {
    void loadStructure();
    void loadData(page, pageSize);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Table2 className="h-4 w-4 text-emerald-400" />
        <span className="font-mono text-sm font-medium">{tab.table}</span>
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
          <Button size="sm" variant="outline" disabled={!structure} onClick={() => setAddOpen(true)}>
            <Plus /> Insert row
          </Button>
          <Button size="sm" variant="outline" onClick={() => void loadData(page, pageSize)} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
          </Button>
          <FilterBar columns={filterColumns} filters={filters} onApply={applyFilters} />
          <ExportMenu
            connectionId={tab.connectionId}
            database={tab.database}
            table={tab.table}
            orderBy={orderBy || undefined}
            filters={filters}
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
            orderBy={orderBy}
            onSort={toggleSort}
            onUpdateCell={handleUpdateCell}
            onDeleteRow={(r) => setDeleteTarget(r)}
            onViewCell={(r, column) => setCellViewer({ open: true, rowIndex: r, column })}
            onJump={(fk, value) => onOpenRef?.(fk, value)}
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
      </div>

      <AddRowDialog open={addOpen} onOpenChange={setAddOpen} columns={columnsMeta} onSubmit={handleInsert} />

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
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center text-muted-foreground">{children}</div>;
}
