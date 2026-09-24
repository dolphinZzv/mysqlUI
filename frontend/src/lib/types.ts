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

export interface TableStructure {
  name: string;
  type: string;
  engine: string;
  comment: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
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
