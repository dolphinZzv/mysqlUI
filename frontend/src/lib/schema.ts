import type { ColumnDefInput } from "./types";

export const COLUMN_TYPES = [
  "int",
  "bigint",
  "smallint",
  "tinyint",
  "mediumint",
  "varchar",
  "char",
  "text",
  "tinytext",
  "mediumtext",
  "longtext",
  "decimal",
  "float",
  "double",
  "date",
  "datetime",
  "timestamp",
  "time",
  "year",
  "json",
  "blob",
  "tinyblob",
  "mediumblob",
  "longblob",
  "enum",
  "set",
  "boolean",
];

export function emptyColumn(partial: Partial<ColumnDefInput> = {}): ColumnDefInput {
  return {
    name: "",
    type: "varchar",
    length: "255",
    nullable: true,
    autoIncrement: false,
    primaryKey: false,
    unique: false,
    default: null,
    hasDefault: false,
    comment: "",
    unsigned: false,
    ...partial,
  };
}

export function defaultNewTableColumns(): ColumnDefInput[] {
  return [
    emptyColumn({ name: "id", type: "int", length: "", nullable: false, autoIncrement: true, primaryKey: true }),
  ];
}

/** Split a MySQL type like "varchar(100)" into base + length for the editor. */
export function splitType(type: string): { base: string; length: string } {
  const m = /^([A-Za-z0-9_ ]+?)(?:\(([^)]*)\))?$/.exec(type.trim());
  if (!m) return { base: type, length: "" };
  return { base: (m[1] || "").trim().toLowerCase(), length: (m[2] || "").trim() };
}
