import { LoginForm } from "./login-form";

export const metadata = {
  title: "Вход · Maxmobiles",
};

type SearchParams = Promise<{ from?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const from = typeof params.from === "string" ? params.from : "/";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="mb-2 h-10 w-10 rounded-md bg-foreground" />
          <h1 className="text-balance text-xl font-semibold tracking-tight text-foreground">
            Maxmobiles · Прайс-портал
          </h1>
          <p className="text-pretty text-sm text-muted-foreground">
            Вход для команды. Введите общий пароль портала.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <LoginForm redirectTo={from} />
        </div>

        <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Пароль обновляется в Vercel · сессия живёт 30 дней
        </p>
      </div>
    </main>
  );
}
