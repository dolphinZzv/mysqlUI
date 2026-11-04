/**
 * Conservative detection of query results that can be edited in place.
 *
 * Only a single plain SELECT from one base table is accepted. Expressions,
 * aliases, joins, aggregates and multiple statements are deliberately rejected
 * because mapping their result cells back to a table row is ambiguous.
 */
export interface EditableQueryTarget {
  database: string;
  table: string;
  /** Explicit selected columns, or [] when the query uses * / table.*. */
  columns: string[];
  star: boolean;
}

/** Replace comments and string literals with spaces while keeping identifiers. */
function maskSql(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const quote = c;
      out += " ";
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out += "  ";
            i += 2;
            continue;
          }
          out += " ";
          i++;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "`") {
      out += c;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "`") {
          if (sql[i + 1] === "`") {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "#" || (c === "-" && sql[i + 1] === "-")) {
      const end = sql.indexOf("\n", i);
      const stop = end < 0 ? sql.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function unquoteIdentifier(value: string): string {
  const text = value.trim();
  if (text.startsWith("`") && text.endsWith("`")) {
    return text.slice(1, -1).replace(/``/g, "`");
  }
  return text;
}

function splitQualified(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inBacktick = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "`") {
      inBacktick = !inBacktick;
      current += c;
      continue;
    }
    if (c === "." && !inBacktick) {
      parts.push(unquoteIdentifier(current));
      current = "";
      continue;
    }
    current += c;
  }
  parts.push(unquoteIdentifier(current));
  return parts.filter(Boolean);
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inBacktick = false;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "`") {
      inBacktick = !inBacktick;
      current += c;
      continue;
    }
    if (!inBacktick) {
      if (c === "(") depth++;
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (c === separator && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

const IDENT = "(?:`(?:[^`]|``)+`|[A-Za-z0-9_$]+)";
const SELECT_ITEM = new RegExp(`^(?:${IDENT}\\s*\\.\\s*)?(${IDENT})$`);
const QUALIFIED_STAR = new RegExp(`^${IDENT}\\s*\\.\\s*\\*$`);
const TABLE_REF = new RegExp(`^(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?$`);
const FROM_RE = new RegExp(
  `^SELECT\\s+([\\s\\S]+?)\\s+FROM\\s+(${IDENT}(?:\\s*\\.\\s*${IDENT})?)(?:\\s+(?:AS\\s+)?(?!(?:WHERE|GROUP|ORDER|LIMIT|HAVING|FOR|LOCK|USE|FORCE|IGNORE)\\b)(${IDENT}))?([\\s\\S]*)$`,
  "i"
);

export function parseEditableQuery(sql: string, defaultDatabase: string): EditableQueryTarget | null {
  const cleaned = maskSql(sql).trim().replace(/;+\s*$/, "");
  if (!cleaned || cleaned.includes(";")) return null;
  if (!/^SELECT\b/i.test(cleaned)) return null;
  if (/\b(?:DISTINCT|JOIN|UNION|GROUP\s+BY|HAVING|INTO|PROCEDURE|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE)\b/i.test(cleaned)) {
    return null;
  }
  if (/\b(?:USE|FORCE|IGNORE)\s+(?:INDEX|KEY)\b/i.test(cleaned)) return null;

  const match = FROM_RE.exec(cleaned);
  if (!match) return null;
  const selectList = match[1].trim();
  const tableRef = match[2];
  const tail = match[4] ?? "";
  if (/^\s*,/.test(tail)) return null;

  const tableParts = splitQualified(tableRef);
  if (tableParts.length === 0 || tableParts.length > 2) return null;
  const database = tableParts.length === 2 ? tableParts[0] : defaultDatabase;
  const table = tableParts[tableParts.length - 1];
  if (!database.trim() || !table.trim()) return null;

  const items = splitTopLevel(selectList, ",").map((item) => item.trim());
  if (items.length === 0) return null;

  const columns: string[] = [];
  let star = false;
  for (const item of items) {
    if (!item) return null;
    if (item === "*" || QUALIFIED_STAR.test(item)) {
      star = true;
      continue;
    }
    const columnMatch = SELECT_ITEM.exec(item);
    if (!columnMatch) return null;
    columns.push(unquoteIdentifier(columnMatch[1]));
  }
  if (!star && columns.length === 0) return null;
  return { database, table: unquoteIdentifier(table), columns, star };
}
