const KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "ALTER",
  "DROP", "TABLE", "DATABASE", "SCHEMA", "INDEX", "VIEW", "TRIGGER", "PROCEDURE", "FUNCTION", "EVENT",
  "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "NOT", "NULL", "DEFAULT", "AUTO_INCREMENT",
  "AND", "OR", "IN", "LIKE", "BETWEEN", "IS", "EXISTS", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
  "CROSS", "ON", "GROUP", "BY", "ORDER", "ASC", "DESC", "HAVING", "LIMIT", "OFFSET", "UNION",
  "ALL", "DISTINCT", "AS", "CASE", "WHEN", "THEN", "ELSE", "END", "WITH", "EXPLAIN", "SHOW",
  "DESCRIBE", "USE", "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION", "GRANT", "REVOKE", "IF",
  "REPLACE", "IGNORE", "TRUNCATE", "RENAME", "ADD", "COLUMN", "CONSTRAINT", "CHECK", "ENGINE",
  "CHARSET", "COLLATE", "USING", "STRAIGHT_JOIN", "NATURAL", "OUTER", "FOR", "UPDATE", "LOCK",
]);

const BREAK_BEFORE = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "ORDER", "HAVING", "LIMIT", "UNION", "INSERT", "UPDATE",
  "DELETE", "CREATE", "ALTER", "DROP", "WITH", "VALUES", "SET", "JOIN", "LEFT", "RIGHT", "INNER",
  "CROSS", "ON", "AND", "OR", "RETURNING",
]);

const tokenRe = new RegExp(
  [
    "(\\/\\*[\\s\\S]*?\\*\\/)", // block comment
    "(--[^\\n]*|#[^\\n]*)", // line comment
    "('(?:[^'\\\\]|\\\\.|'')*')", // single quote
    "(\"(?:[^\"\\\\]|\\\\.|\"\")*\")", // double quote
    "(`(?:[^`]|``)*`)", // backtick
    "([A-Za-z_][A-Za-z0-9_$]*)", // word
    "(\\d+(?:\\.\\d+)?)", // number
    "(<=|>=|<>|!=|:=|::|[(),;.])", // punctuation
  ].join("|"),
  "g"
);

function upperKeywords(sql: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  tokenRe.lastIndex = 0;
  while ((m = tokenRe.exec(sql)) !== null) {
    out += sql.slice(last, m.index);
    const word = m[6];
    out += word && KEYWORDS.has(word.toUpperCase()) ? word.toUpperCase() : m[0];
    last = m.index + m[0].length;
  }
  out += sql.slice(last);
  return out;
}

/**
 * Lightweight SQL formatter. It keeps strings/comments/identifiers untouched,
 * uppercases keywords, puts major clauses on their own lines and indents
 * parenthesised blocks. It intentionally avoids reordering or rewriting SQL.
 */
export function formatSQL(input: string): string {
  const sql = upperKeywords(input).trim();
  if (!sql) return "";

  // Placeholders protect quoted strings, comments and identifiers from the
  // whitespace/newline pass.
  const protectedParts: string[] = [];
  const protect = (value: string) => {
    const key = `\u0000${protectedParts.length}\u0000`;
    protectedParts.push(value);
    return key;
  };

  let masked = "";
  let last = 0;
  tokenRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(sql)) !== null) {
    masked += sql.slice(last, m.index);
    const [full, block, line, sq, dq, bt] = m;
    if (block || line || sq || dq || bt) {
      masked += protect(full);
    } else {
      masked += full;
    }
    last = m.index + full.length;
  }
  masked += sql.slice(last);

  const tokens = masked.match(/\u0000\d+\u0000|[^\s]+/g) ?? [];
  let out = "";
  let indent = 0;
  let lineStart = true;
  let parenDepth = 0;

  const newline = () => {
    out = out.replace(/[ \t]+$/g, "");
    if (!out.endsWith("\n")) out += "\n";
    lineStart = true;
  };
  const append = (token: string, spaceBefore: boolean) => {
    if (lineStart) {
      out += "  ".repeat(indent);
      lineStart = false;
    } else if (spaceBefore) {
      out += " ";
    }
    out += token;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const upper = token.toUpperCase();
    const prev = tokens[i - 1];
    const next = tokens[i + 1];

    if (token === "(") {
      append(token, true);
      parenDepth++;
      indent++;
      continue;
    }
    if (token === ")") {
      indent = Math.max(0, indent - 1);
      parenDepth = Math.max(0, parenDepth - 1);
      append(token, false);
      continue;
    }
    if (token === ",") {
      append(token, false);
      continue;
    }
    if (token === ";") {
      append(token, false);
      newline();
      continue;
    }
    if (token === ".") {
      append(token, false);
      continue;
    }

    // Clause breaks only at the top level. "ON"/"AND"/"OR" inside a
    // parenthesised condition stay on the same line.
    const isClauseBreak = parenDepth === 0 && BREAK_BEFORE.has(upper) && out.trim() !== "";
    const isJoinBreak =
      parenDepth === 0 && (upper === "LEFT" || upper === "RIGHT" || upper === "INNER" || upper === "CROSS" || upper === "JOIN") && out.trim() !== "";
    if ((isClauseBreak || isJoinBreak) && !lineStart) {
      // Avoid breaking "ORDER BY", "GROUP BY", "LEFT JOIN" etc. into two lines.
      const prevUpper = (prev ?? "").toUpperCase();
      const compound =
        (prevUpper === "ORDER" || prevUpper === "GROUP" || prevUpper === "LEFT" || prevUpper === "RIGHT" ||
          prevUpper === "INNER" || prevUpper === "CROSS" || prevUpper === "NATURAL" || prevUpper === "UNION") &&
        (upper === "BY" || upper === "JOIN" || upper === "ALL" || upper === "DISTINCT");
      if (!compound) newline();
    }

    const noSpaceBefore = token === ")" || token === "," || token === "." || token === ";";
    const noSpaceAfterPrev = prev === "(" || prev === "." || prev === "`";
    const startsFunction = next === "(" && /^[A-Za-z_]/.test(token);
    append(token, !lineStart && !noSpaceBefore && !noSpaceAfterPrev && !startsFunction);
  }

  // Restore protected fragments after formatting.
  let result = out.trim();
  for (let i = 0; i < protectedParts.length; i++) {
    result = result.split(`\u0000${i}\u0000`).join(protectedParts[i]);
  }
  return result.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}
