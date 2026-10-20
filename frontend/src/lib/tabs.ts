export interface TableTabDef {
  id: string;
  customTitle?: string;
  kind: "table";
  connectionId: string;
  connectionName: string;
  database: string;
  table: string;
  title: string;
}

export interface QueryTabDef {
  id: string;
  customTitle?: string;
  initialSql?: string;
  initialSelection?: { start: number; end: number };
  kind: "query";
  connectionId: string;
  connectionName: string;
  database: string;
  title: string;
}

export type GenericTabKind = "monitor" | "users" | "erd" | "diff" | "crossdiff" | "routines" | "versions";

export interface GenericTabDef {
  id: string;
  customTitle?: string;
  kind: GenericTabKind;
  connectionId: string;
  connectionName: string;
  database: string;
  title: string;
}

export type TabDef = TableTabDef | QueryTabDef | GenericTabDef;

export const tableTabId = (connectionId: string, database: string, table: string) =>
  `table:${connectionId}:${database}:${table}`;

export const genericTabId = (kind: GenericTabKind, connectionId: string, database: string) =>
  `${kind}:${connectionId}:${database}`;
