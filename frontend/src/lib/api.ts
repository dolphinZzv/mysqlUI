import type {
  ColumnDefInput,
  Connection,
  ConnectionInput,
  ConnectionTestResult,
  CreateTableRequest,
  DatabaseInfo,
  FilterCondition,
  IndexDefInput,
  QueryResult,
  ServerInfo,
  TableData,
  TableInfo,
  TableStructure,
} from "./types";

const BASE = "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (data && typeof data === "object" && "error" in data) {
      message = String((data as { error: unknown }).error);
    } else if (typeof data === "string" && data) {
      message = data;
    }
    throw new Error(message);
  }
  return data as T;
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

const connBase = (id: string) => `/connections/${enc(id)}`;
const dbBase = (id: string, db: string) => `${connBase(id)}/databases/${enc(db)}`;
const tableBase = (id: string, db: string, table: string) =>
  `${dbBase(id, db)}/tables/${enc(table)}`;

function dataQuery(limit: number, offset: number, orderBy?: string, filters?: FilterCondition[]): string {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (orderBy) params.set("orderBy", orderBy);
  if (filters && filters.length) params.set("filters", JSON.stringify(filters));
  return params.toString();
}

export const api = {
  // connections
  listConnections: () => request<Connection[]>("/connections"),

  createConnection: (input: ConnectionInput) =>
    request<{ connection: Connection; connected: boolean; latencyMs?: number; error?: string }>("/connections", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateConnection: (id: string, input: ConnectionInput) =>
    request<{ connection: Connection; connected: boolean; error?: string }>(connBase(id), {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  deleteConnection: (id: string) => request<{ ok: boolean }>(connBase(id), { method: "DELETE" }),

  testNewConnection: (input: ConnectionInput) =>
    request<ConnectionTestResult>("/connections/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  testConnection: (id: string) =>
    request<ConnectionTestResult>(`${connBase(id)}/test`, { method: "POST", body: "{}" }),

  serverInfo: (id: string) => request<ServerInfo>(`${connBase(id)}/info`),

  version: () => request<{ version: string }>("/version"),
  // schema
  listDatabases: (id: string) => request<DatabaseInfo[]>(`${connBase(id)}/databases`),

  listTables: (id: string, db: string) => request<TableInfo[]>(`${dbBase(id, db)}/tables`),

  tableStructure: (id: string, db: string, table: string) =>
    request<TableStructure>(`${tableBase(id, db, table)}/structure`),

  tableData: (
    id: string,
    db: string,
    table: string,
    limit: number,
    offset: number,
    orderBy?: string,
    filters?: FilterCondition[]
  ) => request<TableData>(`${tableBase(id, db, table)}/data?${dataQuery(limit, offset, orderBy, filters)}`),

  insertRow: (id: string, db: string, table: string, data: Record<string, unknown>) =>
    request<{ affected: number; lastInsertId: number }>(`${tableBase(id, db, table)}/rows`, {
      method: "POST",
      body: JSON.stringify({ data }),
    }),

  updateRow: (
    id: string,
    db: string,
    table: string,
    data: Record<string, unknown>,
    primaryKey: Record<string, unknown>
  ) =>
    request<{ affected: number }>(`${tableBase(id, db, table)}/rows`, {
      method: "PUT",
      body: JSON.stringify({ data, primaryKey }),
    }),

  deleteRow: (id: string, db: string, table: string, primaryKey: Record<string, unknown>) =>
    request<{ affected: number }>(`${tableBase(id, db, table)}/rows`, {
      method: "DELETE",
      body: JSON.stringify({ primaryKey }),
    }),

  // table designer (DDL)
  createTable: (id: string, db: string, body: CreateTableRequest) =>
    request<{ ok: boolean; sql: string }>(`${dbBase(id, db)}/tables`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  dropTable: (id: string, db: string, table: string) =>
    request<{ ok: boolean }>(tableBase(id, db, table), { method: "DELETE" }),

  renameTable: (id: string, db: string, table: string, newName: string) =>
    request<{ ok: boolean }>(`${tableBase(id, db, table)}/rename`, {
      method: "POST",
      body: JSON.stringify({ newName }),
    }),

  addColumn: (id: string, db: string, table: string, column: ColumnDefInput, after?: string) =>
    request<{ ok: boolean }>(`${tableBase(id, db, table)}/columns`, {
      method: "POST",
      body: JSON.stringify({ ...column, after }),
    }),

  modifyColumn: (id: string, db: string, table: string, oldName: string, column: ColumnDefInput) =>
    request<{ ok: boolean }>(`${tableBase(id, db, table)}/columns/${enc(oldName)}`, {
      method: "PUT",
      body: JSON.stringify(column),
    }),

  dropColumn: (id: string, db: string, table: string, column: string) =>
    request<{ ok: boolean }>(`${tableBase(id, db, table)}/columns/${enc(column)}`, {
      method: "DELETE",
    }),

  addIndex: (id: string, db: string, table: string, index: IndexDefInput) =>
    request<{ ok: boolean }>(`${tableBase(id, db, table)}/indexes`, {
      method: "POST",
      body: JSON.stringify(index),
    }),

  dropIndex: (id: string, db: string, table: string, index: string) =>
    request<{ ok: boolean }>(`${tableBase(id, db, table)}/indexes/${enc(index)}`, {
      method: "DELETE",
    }),

  // query
  runQuery: (id: string, database: string, sql: string) =>
    request<QueryResult>(`${connBase(id)}/query`, {
      method: "POST",
      body: JSON.stringify({ database, sql }),
    }),
};

// ---- download helpers (Content-Disposition endpoints) --------------------

export function tableExportUrl(
  id: string,
  db: string,
  table: string,
  format: "csv" | "json" | "sql",
  orderBy?: string,
  filters?: FilterCondition[]
): string {
  const params = new URLSearchParams({ format });
  if (orderBy) params.set("orderBy", orderBy);
  if (filters && filters.length) params.set("filters", JSON.stringify(filters));
  return `${BASE}${tableBase(id, db, table)}/export?${params.toString()}`;
}

export function databaseExportUrl(id: string, db: string, format: "sql" = "sql"): string {
  return `${BASE}${dbBase(id, db)}/export?format=${format}`;
}

export function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
