export type ParamValue = string | number | boolean | null;

export interface ParamSet {
  id: string;
  name: string;
  connectionName?: string;
  database?: string;
  values: Record<string, ParamValue>;
  sql?: string;
  savedAt: number;
}

const SETS_KEY = "mysqlui.sqlParamSets";

const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const NAME_FULL = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Finds :name and {{name}} placeholders outside quoted strings, comments and
 * backtick identifiers. MySQL's := assignment and :: casts are ignored.
 */
export function extractParams(sql: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
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
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (c === "{" && sql[i + 1] === "{") {
      const end = sql.indexOf("}}", i + 2);
      if (end > 0) {
        const name = sql.slice(i + 2, end).trim();
        if (NAME_FULL.test(name)) {
          if (!found.includes(name)) found.push(name);
          i = end + 2;
          continue;
        }
      }
      i++;
      continue;
    }
    if (c === ":") {
      if (sql[i - 1] === ":" || sql[i + 1] === ":" || sql[i + 1] === "=") {
        i++;
        continue;
      }
      NAME.lastIndex = i + 1;
      const match = NAME.exec(sql);
      if (match) {
        const name = match[0];
        if (!found.includes(name)) found.push(name);
        i = NAME.lastIndex;
        continue;
      }
    }
    i++;
  }
  return found;
}

export function sqlLiteral(value: ParamValue): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  let out = "'";
  for (const ch of value) {
    if (ch === "\\") out += "\\\\";
    else if (ch === "'") out += "\\'";
    else if (ch === "\0") out += "\\0";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\x1a") out += "\\Z";
    else out += ch;
  }
  return out + "'";
}

export function applyParams(sql: string, values: Record<string, ParamValue>): string {
  let i = 0;
  let out = "";
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "\\") {
          if (i + 1 < sql.length) out += sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
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
      if (end < 0) {
        out += sql.slice(i);
        break;
      }
      out += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) {
        out += sql.slice(i);
        break;
      }
      out += sql.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (c === "{" && sql[i + 1] === "{") {
      const end = sql.indexOf("}}", i + 2);
      if (end > 0) {
        const name = sql.slice(i + 2, end).trim();
        if (NAME_FULL.test(name)) {
          out += sqlLiteral(values[name] ?? null);
          i = end + 2;
          continue;
        }
      }
    }
    if (c === ":" && sql[i - 1] !== ":" && sql[i + 1] !== ":" && sql[i + 1] !== "=") {
      NAME.lastIndex = i + 1;
      const match = NAME.exec(sql);
      if (match) {
        out += sqlLiteral(values[match[0]] ?? null);
        i = NAME.lastIndex;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

export function loadParamSets(): ParamSet[] {
  try {
    const raw = localStorage.getItem(SETS_KEY);
    const parsed = raw ? (JSON.parse(raw) as ParamSet[]) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => s && s.name && s.values) : [];
  } catch {
    return [];
  }
}

export function saveParamSet(set: Omit<ParamSet, "id" | "savedAt">): ParamSet {
  const list = loadParamSets();
  const existing = list.find((s) => s.name.toLowerCase() === set.name.toLowerCase());
  const next: ParamSet = {
    ...set,
    id: existing?.id ?? `ps:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
  };
  const updated = existing
    ? list.map((s) => (s.id === existing.id ? next : s))
    : [next, ...list].slice(0, 100);
  localStorage.setItem(SETS_KEY, JSON.stringify(updated));
  return next;
}

export function deleteParamSet(id: string): void {
  localStorage.setItem(SETS_KEY, JSON.stringify(loadParamSets().filter((s) => s.id !== id)));
}
