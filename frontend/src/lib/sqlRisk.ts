function stripCommentsAndStrings(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += " ";
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
      out += " ";
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export interface SqlRisk {
  level: "danger" | "warning";
  message: string;
}

export function assessSQLRisk(sql: string): SqlRisk[] {
  const cleaned = stripCommentsAndStrings(sql).trim();
  if (!cleaned) return [];
  const upper = cleaned.toUpperCase();
  const risks: SqlRisk[] = [];
  if (/^\s*UPDATE\b/i.test(cleaned) && !/\bWHERE\b/i.test(cleaned)) {
    risks.push({ level: "danger", message: "UPDATE without WHERE will affect every row." });
  }
  if (/^\s*DELETE\b/i.test(cleaned) && !/\bWHERE\b/i.test(cleaned)) {
    risks.push({ level: "danger", message: "DELETE without WHERE will remove every row." });
  }
  if (/^\s*DROP\s+DATABASE\b/i.test(cleaned)) {
    risks.push({ level: "danger", message: "DROP DATABASE permanently removes a database." });
  }
  if (/^\s*DROP\s+TABLE\b/i.test(cleaned)) {
    risks.push({ level: "danger", message: "DROP TABLE permanently removes a table." });
  }
  if (/^\s*TRUNCATE\b/i.test(cleaned)) {
    risks.push({ level: "danger", message: "TRUNCATE removes all rows and cannot be rolled back in most engines." });
  }
  if (/^\s*ALTER\s+TABLE\b/i.test(cleaned) && /\bDROP\b/i.test(cleaned)) {
    risks.push({ level: "warning", message: "ALTER TABLE ... DROP can permanently remove data." });
  }
  return risks;
}

export function hasWhereClause(sql: string): boolean {
  return /\bWHERE\b/i.test(stripCommentsAndStrings(sql));
}
