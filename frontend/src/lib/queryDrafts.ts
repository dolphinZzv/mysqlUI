export interface QueryDraft {
  sql: string;
  selection?: { start: number; end: number };
}

const KEY_PREFIX = "mysqlui.queryDraft.";

export function readQueryDraft(tabId: string): QueryDraft | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + tabId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QueryDraft;
    return typeof parsed?.sql === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeQueryDraft(tabId: string, draft: QueryDraft): void {
  try {
    localStorage.setItem(KEY_PREFIX + tabId, JSON.stringify(draft));
  } catch {
    /* ignore quota errors */
  }
}

export function deleteQueryDraft(tabId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + tabId);
  } catch {
    /* ignore */
  }
}
