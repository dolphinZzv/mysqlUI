export interface SSHConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  authMethod: "password" | "key";
  password: string;
  privateKey: string;
  passphrase: string;
  ignoreHostKey: boolean;
}

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: string;
  color?: string;
  ssh?: SSHConfig;
}

export interface ConnectionInput {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: string;
  color?: string;
  ssh?: SSHConfig;
}

export interface DatabaseInfo {
  name: string;
  charset: string;
  collation: string;
  isSystem: boolean;
}

export interface TableInfo {
  name: string;
  type: string;
  engine: string;
  rows: number;
  comment: string;
  collation: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  collation: string | null;
  nullable: boolean;
  key: string;
  default: unknown;
  extra: string;
  comment: string;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  seq: number;
  column: string;
  cardinality: number | null;
  indexType: string;
}

export interface ForeignKeyInfo {
  column: string;
  refDatabase: string;
  refTable: string;
  refColumn: string;
  constraint: string;
}

export interface TableStructure {
  name: string;
  type: string;
  engine: string;
  comment: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  createSql: string;
}

export interface TableData {
  columns: string[];
  rows: unknown[][];
  total: number;
  limit: number;
  offset: number;
  primaryKey: string[];
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  affected: number;
  lastInsertId: number;
  durationMs: number;
  message: string;
  truncated: boolean;
  isQuery: boolean;
}

export interface ConnectionTestResult {
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

export interface FilterCondition {
  column: string;
  op: string;
  value?: unknown;
}

export interface ColumnDefInput {
  name: string;
  type: string;
  length: string;
  nullable: boolean;
  autoIncrement: boolean;
  primaryKey: boolean;
  unique: boolean;
  default: unknown;
  hasDefault: boolean;
  comment: string;
  unsigned: boolean;
}

export interface IndexDefInput {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface CreateTableRequest {
  name: string;
  engine: string;
  charset: string;
  collation: string;
  comment: string;
  columns: ColumnDefInput[];
  indexes: IndexDefInput[];
}

export interface ServerInfo {
  version: string;
  comment: string;
  hostname: string;
  port: number;
  currentDatabase: string;
  databaseCount: number;
}

// ---- tier 1/2/3 additions ----

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
}

export interface ProcessInfo {
  id: number;
  user: string;
  host: string;
  db: string;
  command: string;
  time: number;
  state: string;
  info: string;
}

export interface MonitorOverview {
  version: string;
  uptime: number;
  threadsConnected: number;
  threadsRunning: number;
  questions: number;
  slowQueries: number;
  qps: number;
  bytesReceived: number;
  bytesSent: number;
  connections: number;
  abortedConnects: number;
  innodbBufferPoolSize: number;
  innodbRowLockWaits: number;
}

export interface NameValue {
  name: string;
  value: string;
}

export interface UserInfo {
  user: string;
  host: string;
  plugin: string;
  accountLocked: string;
}

export interface RoutineInfo {
  name: string;
  type: string;
  returns: string;
  definer: string;
  security: string;
  comment: string;
  created: string;
  modified: string;
}

export interface TriggerInfo {
  name: string;
  event: string;
  table: string;
  timing: string;
  definer: string;
  created: string;
}

export interface EventInfo {
  name: string;
  status: string;
  interval: string;
  starts: string;
  ends: string;
  definer: string;
  comment: string;
}

export interface ErdTable {
  name: string;
}

export interface ErdEdge {
  constraint: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface ErdResponse {
  tables: ErdTable[];
  edges: ErdEdge[];
}

export interface SchemaColumn {
  name: string;
  columnType: string;
  nullable: boolean;
  key: string;
  extra: string;
  default: string | null;
  comment: string;
}

export interface ColumnChange {
  name: string;
  source: SchemaColumn;
  target: SchemaColumn;
}

export interface SchemaIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface SchemaDiffResult {
  columnsAdded: SchemaColumn[];
  columnsRemoved: SchemaColumn[];
  columnsChanged: ColumnChange[];
  indexesAdded: SchemaIndex[];
  indexesRemoved: SchemaIndex[];
  ddl: string[];
}

export interface TableHit {
  database: string;
  table: string;
  tableType: string;
  comment: string;
}

export interface ColumnHit {
  database: string;
  table: string;
  column: string;
  columnType: string;
  key: string;
  comment: string;
}

export interface SearchResult {
  tables: TableHit[];
  columns: ColumnHit[];
}

export interface CellValue {
  isNull: boolean;
  size: number;
  mime: string;
  base64: string;
  truncated: boolean;
}

export interface DefinitionResult {
  columns: string[];
  ddl: string;
  row: unknown[];
}
