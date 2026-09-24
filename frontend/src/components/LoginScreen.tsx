import { useState } from "react";
import { Database, Loader2, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Database className="h-7 w-7" />
          </div>
          <h1 className="text-lg font-semibold">{t("login.title", "Sign in to MySQL UI")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("login.desc", "Enter the access password.")}</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password">{t("login.password", "Password")}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              autoFocus
              className="pl-9"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" className="mt-4 w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? t("login.loggingIn", "Signing in…") : t("login.submit", "Sign in")}
        </Button>
      </form>
    </div>
  );
}
