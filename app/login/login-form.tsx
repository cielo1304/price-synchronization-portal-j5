"use client";

import { useState } from "react";
import { Lock, Loader2, ArrowRight } from "lucide-react";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Не удалось войти");
        setPassword("");
        return;
      }
      // Полный refresh, чтобы proxy.ts сразу увидел новую cookie.
      // Защищаемся от open-redirect: пускаем только относительные пути.
      const target =
        redirectTo.startsWith("/") && !redirectTo.startsWith("//")
          ? redirectTo
          : "/";
      window.location.href = target;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Сеть недоступна");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground">Пароль</span>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/10"
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>
      </label>

      {error && (
        <div
          id="login-error"
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || password.length === 0}
        className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-foreground text-sm font-medium text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Проверяем...
          </>
        ) : (
          <>
            Войти
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
