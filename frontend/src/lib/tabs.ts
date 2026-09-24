export interface TableTabDef {
  id: string;
  kind: "table";
  connectionId: string;
  connectionName: string;
  database: string;
  table: string;
  title: string;
}

export interface QueryTabDef {
  id: string;
  kind: "query";
  connectionId: string;
  connectionName: string;
  database: string;
  title: string;
}

export type GenericTabKind = "monitor" | "users" | "erd" | "diff" | "routines";

export interface GenericTabDef {
  id: string;
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
