import type {
  AuthStatus,
  CellValue,
  ColumnDefInput,
  Connection,
  ConnectionInput,
  ConnectionTestResult,
  CreateTableRequest,
  DatabaseInfo,
  DefinitionResult,
  ErdResponse,
  EventInfo,
  FilterCondition,
  IndexDefInput,
  MonitorOverview,
  NameValue,
  ProcessInfo,
  QueryResult,
  RoutineInfo,
  SchemaDiffResult,
  SearchResult,
  ServerInfo,
  TableData,
  TableInfo,
  TableStructure,
  TriggerInfo,
  UserInfo,
} from "./types";

const BASE = "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    window.dispatchEvent(new Event("mysqlui:unauthorized"));
  }

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

async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event("mysqlui:unauthorized"));
  }
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
const tableBase = (id: string, db: string, table: string) => `${dbBase(id, db)}/tables/${enc(table)}`;

function dataQuery(limit: number, offset: number, orderBy?: string, filters?: FilterCondition[]): string {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (orderBy) params.set("orderBy", orderBy);
  if (filters && filters.length) params.set("filters", JSON.stringify(filters));
  return params.toString();
}

export const api = {
  // auth
  authStatus: () => request<AuthStatus>("/auth/status"),
  login: (password: string) =>
    request<{ ok: boolean; token?: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST", body: "{}" }),

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
    request<ConnectionTestResult>("/connections/test", { method: "POST", body: JSON.stringify(input) }),
  testConnection: (id: string) =>
    request<ConnectionTestResult>(`${connBase(id)}/test`, { method: "POST", body: "{}" }),
  serverInfo: (id: string) => request<ServerInfo>(`${connBase(id)}/info`),

  // schema
  listDatabases: (id: string) => request<DatabaseInfo[]>(`${connBase(id)}/databases`),
  listTables: (id: string, db: string) => request<TableInfo[]>(`${dbBase(id, db)}/tables`),
  databaseSchema: (id: string, db: string) =>
    request<{ tables: { name: string; columns: string[] }[] }>(`${dbBase(id, db)}/schema`),
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
  cellValue: (id: string, db: string, table: string, column: string, primaryKey: Record<string, unknown>) =>
    request<CellValue>(`${tableBase(id, db, table)}/cell`, {
      method: "POST",
      body: JSON.stringify({ column, primaryKey }),
    }),

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
    request<{ ok: boolean; sql: string }>(`${dbBase(id, db)}/tables`, { method: "POST", body: JSON.stringify(body) }),
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
    request<{ ok: boolean }>(`${tableBase(id, db, table)}/columns/${enc(column)}`, { method: "DELETE" }),
  addIndex: (id: string, db: string, table: string, index: IndexDefInput) =>
    request<{ ok: boolean }>(`${tableBase(id, db, table)}/indexes`, {
      method: "POST",
      body: JSON.stringify(index),
    }),
  dropIndex: (id: string, db: string, table: string, index: string) =>
    request<{ ok: boolean }>(`${tableBase(id, db, table)}/indexes/${enc(index)}`, { method: "DELETE" }),

  // query & DDL
  runQuery: (id: string, database: string, sql: string) =>
    request<QueryResult>(`${connBase(id)}/query`, {
      method: "POST",
      body: JSON.stringify({ database, sql }),
    }),
  executeDDL: (id: string, db: string, sql: string) =>
    request<{ columns?: string[]; rows?: unknown[][]; affected?: number }>(`${dbBase(id, db)}/ddl`, {
      method: "POST",
      body: JSON.stringify({ sql }),
    }),

  // server monitor
  processList: (id: string) => request<ProcessInfo[]>(`${connBase(id)}/monitor/processlist`),
  monitorOverview: (id: string) => request<MonitorOverview>(`${connBase(id)}/monitor/overview`),
  monitorStatus: (id: string) => request<NameValue[]>(`${connBase(id)}/monitor/status`),
  monitorVariables: (id: string) => request<NameValue[]>(`${connBase(id)}/monitor/variables`),
  killProcess: (id: string, pid: number, queryOnly: boolean) =>
    request<{ ok: boolean }>(`${connBase(id)}/monitor/process/${pid}?query=${queryOnly}`, { method: "DELETE" }),

  // import
  importCSV: (
    id: string,
    db: string,
    table: string,
    file: File,
    opts: { hasHeader: boolean; truncate: boolean; nullValue: string; delimiter: string }
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("hasHeader", String(opts.hasHeader));
    form.append("truncate", String(opts.truncate));
    form.append("nullValue", opts.nullValue);
    form.append("delimiter", opts.delimiter);
    return upload<{ imported: number; columns: string[] }>(`${tableBase(id, db, table)}/import`, form);
  },
  importSQL: (id: string, db: string | null, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const path = db ? `${dbBase(id, db)}/import/sql` : `${connBase(id)}/import/sql`;
    return upload<{ statements: number }>(path, form);
  },

  // users & privileges
  listUsers: (id: string) => request<UserInfo[]>(`${connBase(id)}/users`),
  userGrants: (id: string, host: string, user: string) =>
    request<string[]>(`${connBase(id)}/users/${enc(host)}/${enc(user)}/grants`),
  createUser: (id: string, body: { user: string; host: string; password: string }) =>
    request<{ ok: boolean }>(`${connBase(id)}/users`, { method: "POST", body: JSON.stringify(body) }),
  alterUser: (id: string, host: string, user: string, password: string) =>
    request<{ ok: boolean }>(`${connBase(id)}/users/${enc(host)}/${enc(user)}`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    }),
  dropUser: (id: string, host: string, user: string) =>
    request<{ ok: boolean }>(`${connBase(id)}/users/${enc(host)}/${enc(user)}`, { method: "DELETE" }),
  grant: (
    id: string,
    host: string,
    user: string,
    body: { privileges: string[]; database: string; table: string; withGrantOption: boolean }
  ) =>
    request<{ ok: boolean }>(`${connBase(id)}/users/${enc(host)}/${enc(user)}/grant`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  revoke: (id: string, host: string, user: string, body: { privileges: string[]; database: string; table: string }) =>
    request<{ ok: boolean }>(`${connBase(id)}/users/${enc(host)}/${enc(user)}/revoke`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // routines / triggers / events
  listRoutines: (id: string, db: string) => request<RoutineInfo[]>(`${dbBase(id, db)}/routines`),
  listTriggers: (id: string, db: string) => request<TriggerInfo[]>(`${dbBase(id, db)}/triggers`),
  listEvents: (id: string, db: string) => request<EventInfo[]>(`${dbBase(id, db)}/events`),
  definition: (id: string, db: string, kind: "routine" | "trigger" | "event", type: string, name: string) => {
    if (kind === "routine") {
      return request<DefinitionResult>(`${dbBase(id, db)}/routines/${enc(type)}/${enc(name)}/definition`);
    }
    return request<DefinitionResult>(`${dbBase(id, db)}/${kind}s/${enc(name)}/definition`);
  },
  dropRoutine: (id: string, db: string, type: string, name: string) =>
    request<{ ok: boolean }>(`${dbBase(id, db)}/routines/${enc(type)}/${enc(name)}`, { method: "DELETE" }),
  dropTrigger: (id: string, db: string, name: string) =>
    request<{ ok: boolean }>(`${dbBase(id, db)}/triggers/${enc(name)}`, { method: "DELETE" }),
  dropEvent: (id: string, db: string, name: string) =>
    request<{ ok: boolean }>(`${dbBase(id, db)}/events/${enc(name)}`, { method: "DELETE" }),

  // search / erd / diff
  globalSearch: (id: string, q: string) =>
    request<SearchResult>(`${connBase(id)}/search?q=${enc(q)}`),
  erd: (id: string, db: string) => request<ErdResponse>(`${dbBase(id, db)}/erd`),
  schemaDiff: (
    id: string,
    source: { database: string; table: string },
    target: { database: string; table: string }
  ) =>
    request<SchemaDiffResult>(`${connBase(id)}/diff`, {
      method: "POST",
      body: JSON.stringify({ source, target }),
    }),

  version: () => request<{ version: string }>("/version"),
};

// ---- download helpers ----------------------------------------------------

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

export function serverExportUrl(id: string, format: "sql" = "sql"): string {
  return `${BASE}${connBase(id)}/export?format=${format}`;
}

export function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
