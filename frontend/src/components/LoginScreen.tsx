import { useEffect, useState } from "react";
import { Database, Loader2, Lock, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setTotp(Boolean(s.totp)))
      .catch(() => setTotp(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password, totp ? code : undefined);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || !password || (totp && code.length !== 6);

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Database className="h-7 w-7" />
          </div>
          <h1 className="text-lg font-semibold">{t("login.title", "Sign in to MySQL UI")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totp
              ? t("login.descTotp", "Enter the access password and your one-time code.")
              : t("login.desc", "Enter the access password.")}
          </p>
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

        {totp && (
          <div className="mt-3 grid gap-2">
            <Label htmlFor="code">{t("login.code", "One-time code")}</Label>
            <div className="relative">
              <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="pl-9 font-mono tracking-[0.3em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" className="mt-4 w-full" disabled={disabled}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? t("login.loggingIn", "Signing in…") : t("login.submit", "Sign in")}
        </Button>
      </form>
    </div>
  );
}
