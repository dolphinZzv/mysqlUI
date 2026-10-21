import type { ColumnDefInput, CreateTableRequest } from "@/lib/types";

export const quoteIdent = (name: string) => "`" + name.replace(/`/g, "``") + "`";

export function sqlString(value: string): string {
  return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function defaultValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  const text = String(value).trim();
  if (/^(NULL|CURRENT_TIMESTAMP(\(\))?|CURRENT_DATE|CURRENT_TIME)$/i.test(text)) return text;
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  return sqlString(text);
}

export function columnDef(column: ColumnDefInput): string {
  let type = column.type.trim();
  if (column.length.trim() && !type.includes("(")) type += `(${column.length.trim()})`;
  let out = `${quoteIdent(column.name)} ${type}`;
  if (column.unsigned) out += " unsigned";
  out += column.nullable ? " NULL" : " NOT NULL";
  if (column.hasDefault) out += ` DEFAULT ${defaultValue(column.default)}`;
  if (column.autoIncrement) out += " AUTO_INCREMENT";
  if (column.unique) out += " UNIQUE";
  if (column.comment.trim()) out += ` COMMENT ${sqlString(column.comment)}`;
  return out;
}

export function addColumnSQL(table: string, column: ColumnDefInput, after?: string): string {
  return `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${columnDef(column)}${after ? ` AFTER ${quoteIdent(after)}` : ""}`;
}

export function modifyColumnSQL(table: string, oldName: string, column: ColumnDefInput): string {
  return `ALTER TABLE ${quoteIdent(table)} CHANGE COLUMN ${quoteIdent(oldName)} ${columnDef(column)}`;
}

export function addIndexSQL(table: string, name: string, columns: string[], unique: boolean): string {
  return `ALTER TABLE ${quoteIdent(table)} ADD ${unique ? "UNIQUE " : ""}INDEX ${quoteIdent(name)} (${columns
    .map(quoteIdent)
    .join(", ")})`;
}

export function tableOptionsSQL(table: string, options: { engine: string; charset: string; collation: string; comment: string }): string {
  const clauses: string[] = [];
  if (options.engine.trim()) clauses.push(`ENGINE=${options.engine.trim()}`);
  if (options.charset.trim()) clauses.push(`DEFAULT CHARACTER SET ${options.charset.trim()}`);
  if (options.collation.trim()) clauses.push(`COLLATE ${options.collation.trim()}`);
  if (options.comment.trim()) clauses.push(`COMMENT=${sqlString(options.comment.trim())}`);
  return clauses.length ? `ALTER TABLE ${quoteIdent(table)} ${clauses.join(" ")}` : "";
}

export function createTableSQL(request: CreateTableRequest): string {
  const lines: string[] = [];
  const primary = request.columns.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name));
  for (const column of request.columns) {
    lines.push("  " + columnDef({ ...column, primaryKey: false }));
  }
  if (primary.length) lines.push(`  PRIMARY KEY (${primary.join(", ")})`);
  for (const index of request.indexes) {
    if (!index.name.trim() || index.columns.length === 0) continue;
    lines.push(
      `  ${index.unique ? "UNIQUE " : ""}INDEX ${quoteIdent(index.name.trim())} (${index.columns
        .map(quoteIdent)
        .join(", ")})`
    );
  }
  let sql = `CREATE TABLE ${quoteIdent(request.name)} (\n${lines.join(",\n")}\n)`;
  if (request.engine.trim()) sql += ` ENGINE=${request.engine.trim()}`;
  if (request.charset.trim()) sql += ` DEFAULT CHARSET=${request.charset.trim()}`;
  if (request.collation.trim()) sql += ` COLLATE=${request.collation.trim()}`;
  if (request.comment.trim()) sql += ` COMMENT=${sqlString(request.comment.trim())}`;
  return sql;
}
