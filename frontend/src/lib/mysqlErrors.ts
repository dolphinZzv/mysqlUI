export interface FriendlyMySQLError {
  code: number | null;
  title: string;
  hint: string;
  raw: string;
}

const HINTS: Record<number, { title: string; hint: string }> = {
  1044: { title: "Access denied", hint: "The account cannot access this database. Check GRANT privileges for the database." },
  1045: { title: "Login failed", hint: "Wrong username/password, host restriction, or the account is locked." },
  1054: { title: "Unknown column", hint: "A column name in the statement does not exist. Check spelling, aliases and the selected database." },
  1062: { title: "Duplicate key", hint: "A UNIQUE/PRIMARY KEY value already exists. Change the value or use INSERT IGNORE / REPLACE." },
  1064: { title: "SQL syntax error", hint: "Check the highlighted line for a missing keyword, quote, comma or semicolon." },
  1142: { title: "Command denied", hint: "The account lacks this privilege on the object. Ask an administrator to GRANT it." },
  1146: { title: "Table does not exist", hint: "The table may have been renamed/dropped, or you are in the wrong database." },
  1205: { title: "Lock wait timeout", hint: "Another transaction holds a lock. Inspect locks/transactions and retry." },
  1213: { title: "Deadlock", hint: "MySQL rolled back this transaction to break a deadlock. Retry the transaction, preferably with rows in a stable order." },
  1264: { title: "Value out of range", hint: "A numeric value is too large/small for the target column type." },
  1265: { title: "Data truncated", hint: "A value does not fit the column type or length. Shorten/normalise the data." },
  1366: { title: "Incorrect string value", hint: "The text contains characters not supported by the column charset/collation." },
  1451: { title: "Foreign key constraint", hint: "Rows in another table reference this row. Delete/update the child rows first or remove the FK constraint." },
  1452: { title: "Foreign key constraint", hint: "The referenced parent row does not exist. Insert the parent first or fix the FK value." },
  2006: { title: "Connection lost", hint: "The MySQL server closed the connection. Check connectivity and retry." },
  2013: { title: "Connection lost", hint: "The connection dropped during the query. Check network/timeout settings and retry." },
};

export function friendlyMySQLError(raw: string): FriendlyMySQLError {
  const match = raw.match(/(?:Error|ERROR|errno)\s*[:=]?\s*(\d{4})/i) ?? raw.match(/\((\d{4})\)/);
  const code = match ? Number(match[1]) : null;
  const known = code !== null ? HINTS[code] : undefined;
  return {
    code,
    title: known?.title ?? "Query failed",
    hint: known?.hint ?? "Review the SQL and server error below. The Details section contains the original message.",
    raw,
  };
}
