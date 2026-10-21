export interface StatementRange {
  text: string;
  start: number;
  end: number;
  startLine: number;
}

export function lineAt(text: string, offset: number): number {
  let line = 1;
  const limit = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < limit; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Returns the statement around the caret, ignoring semicolons inside strings,
 * identifiers and comments. When the caret is in leading whitespace after a
 * semicolon, the following statement is returned.
 */
export function statementAt(sql: string, caret: number): StatementRange {
  const target = Math.max(0, Math.min(caret, sql.length));
  let start = 0;
  let end = sql.length;
  let state: "normal" | "single" | "double" | "backtick" | "line" | "block" = "normal";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (state === "single" || state === "double") {
      const quote = state === "single" ? "'" : '"';
      if (c === "\\") {
        i++;
      } else if (c === quote) {
        if (sql[i + 1] === quote) i++;
        else state = "normal";
      }
      continue;
    }
    if (state === "backtick") {
      if (c === "`") {
        if (sql[i + 1] === "`") i++;
        else state = "normal";
      }
      continue;
    }
    if (state === "line") {
      if (c === "\n") state = "normal";
      continue;
    }
    if (state === "block") {
      if (c === "*" && sql[i + 1] === "/") {
        state = "normal";
        i++;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      state = c === "'" ? "single" : c === '"' ? "double" : "backtick";
      continue;
    }
    if (c === "#" || (c === "-" && sql[i + 1] === "-")) {
      state = "line";
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      state = "block";
      i++;
      continue;
    }
    if (c === ";") {
      if (i < target) {
        start = i + 1;
      } else {
        end = i + 1;
        break;
      }
    }
  }
  let raw = sql.slice(start, end);
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  start += leading;
  raw = raw.trim();
  end = Math.max(start, end - trailing);
  return { text: raw, start, end, startLine: lineAt(sql, start) };
}
