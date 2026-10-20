import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { addSqlSnippet, insertSqlText, removeSqlSnippet, updateSqlSnippet, useSqlSnippets } from "@/lib/sqlSnippets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onClose: () => void;
  currentSql: string;
  connectionName?: string;
  database?: string;
}

export function SnippetPanel({ open, onClose, currentSql, connectionName, database }: Props) {
  const { t } = useI18n();
  const snippets = useSqlSnippets();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [sql, setSql] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter((s) => s.name.toLowerCase().includes(q) || s.sql.toLowerCase().includes(q));
  }, [snippets, search]);

  if (!open) return null;

  const reset = () => {
    setName("");
    setSql("");
    setEditingId(null);
  };

  const save = () => {
    const text = (sql || currentSql).trim();
    if (!text) {
      toast.error(t("snippets.sqlRequired", "SQL is required"));
      return;
    }
    if (editingId) {
      updateSqlSnippet(editingId, name || "Snippet", text);
      toast.success(t("snippets.updated", "Snippet updated"));
    } else {
      addSqlSnippet(name, text);
      toast.success(t("snippets.saved", "Snippet saved"));
    }
    reset();
  };

  const edit = (id: string) => {
    const item = snippets.find((s) => s.id === id);
    if (!item) return;
    setEditingId(id);
    setName(item.name);
    setSql(item.sql);
  };

  return (
    <aside className="flex h-full w-[290px] shrink-0 flex-col border-l bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">{t("snippets.title", "SQL snippets")}</span>
        <span className="text-xs text-muted-foreground">{snippets.length}</span>
        <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={onClose} title={t("common.close", "Close")}>
          <X />
        </Button>
      </div>

      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("snippets.search", "Search snippets")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">{editingId ? t("snippets.edit", "Edit snippet") : t("snippets.new", "New snippet")}</Label>
          <Input
            className="h-8 text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("snippets.name", "Name")}
          />
          <Textarea
            className="min-h-[84px] font-mono text-[11px]"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder={currentSql ? t("snippets.placeholder", "Leave empty to use the current SQL") : "SELECT ..."}
            spellCheck={false}
          />
          <div className="flex gap-1.5">
            <Button size="sm" onClick={save} disabled={!(sql || currentSql).trim()}>
              <Plus /> {editingId ? t("common.save", "Save") : t("snippets.save", "Save snippet")}
            </Button>
            {editingId && (
              <Button size="sm" variant="ghost" onClick={reset}>
                {t("common.cancel", "Cancel")}
              </Button>
            )}
          </div>
        </div>
        {(connectionName || database) && (
          <p className="text-[10px] text-muted-foreground">
            {[connectionName, database].filter(Boolean).join(" / ")}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("snippets.empty", "No snippets yet.")}</p>
        )}
        {filtered.map((item) => (
          <div key={item.id} className="group mb-1 rounded-md border px-2 py-1.5 hover:bg-muted/40">
            <div className="flex items-center gap-1">
              <button className="min-w-0 flex-1 truncate text-left text-xs font-medium" onClick={() => insertSqlText(item.sql)} title={item.sql}>
                {item.name}
              </button>
              <Button size="icon-sm" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => edit(item.id)} title={t("common.edit", "Edit")}>
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="opacity-0 hover:text-destructive group-hover:opacity-100"
                onClick={() => removeSqlSnippet(item.id)}
                title={t("common.delete", "Delete")}
              >
                <Trash2 />
              </Button>
            </div>
            <button className="mt-0.5 block w-full truncate text-left font-mono text-[10px] text-muted-foreground" onClick={() => insertSqlText(item.sql)} title={item.sql}>
              {item.sql.replace(/\s+/g, " ")}
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
