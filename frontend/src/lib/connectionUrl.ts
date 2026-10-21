import type { ConnectionInput } from "@/lib/types";

export interface ParsedConnectionUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: string;
}

export function parseConnectionUrl(input: string): ParsedConnectionUrl | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `mysql://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!/^(mysql|mariadb|mysqlx):$/i.test(url.protocol)) return null;
  if (!url.hostname) return null;
  const ssl = url.searchParams.get("ssl") || url.searchParams.get("tls") || undefined;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username || "root"),
    password: decodeURIComponent(url.password || ""),
    database: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
    ssl: ssl ? (ssl === "true" ? "preferred" : ssl) : undefined,
  };
}

export function applyParsedUrl(base: ConnectionInput, parsed: ParsedConnectionUrl, original: string): ConnectionInput {
  const name = base.name.trim() || `${parsed.database || parsed.host} · ${parsed.user}`;
  return {
    ...base,
    name,
    host: parsed.host,
    port: parsed.port || 3306,
    user: parsed.user,
    password: parsed.password,
    database: parsed.database,
    ssl: parsed.ssl ?? base.ssl ?? "disabled",
  };
}
