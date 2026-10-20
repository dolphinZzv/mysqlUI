import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, View } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  database: string;
  view?: string;
  initialDefinition?: string;
  onSaved?: (name: string) => void;
}

export function ViewDialog({ open, onOpenChange, connectionId, database, view, initialDefinition, onSaved }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(view ?? "");
  const [definition, setDefinition] = useState(initialDefinition ?? "SELECT 1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(view ?? "");
    setDefinition(initialDefinition?.trim() || (view ? "" : "SELECT 1"));
    setBusy(false);
  }, [open, view, initialDefinition]);

  const editing = Boolean(view);

  const submit = async () => {
    if (!name.trim()) {
      toast.error(t("views.nameRequired", "View name is required"));
      return;
    }
    if (!definition.trim()) {
      toast.error(t("views.definitionRequired", "View definition is required"));
      return;
    }
    setBusy(true);
    try {
      await api.saveView(connectionId, database, name.trim(), definition.trim());
      toast.success(editing ? t("views.saved", "View updated") : t("views.created", "View created"));
      onSaved?.(name.trim());
      onOpenChange(false);
    } catch (err) {
      toast.error(t("common.error", "Error"), { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <View className="h-4 w-4 text-primary" />
            {editing ? t("views.edit", "Edit view") : t("views.create", "New view")}
          </DialogTitle>
          <DialogDescription>
            {database} · {editing ? name : t("views.createDesc", "Create a view from a SELECT query.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="view-name" className="text-xs">
              {t("views.name", "View name")}
            </Label>
            <Input
              id="view-name"
              className="h-9 font-mono"
              value={name}
              disabled={editing || busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_view"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="view-definition" className="text-xs">
              {t("views.definition", "SELECT definition")}
            </Label>
            <Textarea
              id="view-definition"
              className="min-h-[220px] font-mono text-[12px]"
              value={definition}
              disabled={busy}
              onChange={(e) => setDefinition(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />}
            {t("common.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
