"use client";

import { useState } from "react";
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Database,
  ArrowRight,
  Box,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TestResult = {
  ok: boolean;
  error?: string;
  warehouses?: Array<{ id: number; title: string }>;
  servicesCount?: number;
  productsSample?: Array<{ id: number; title: string; article?: string | null }>;
};

type DryRunResult = {
  ok: boolean;
  error?: string;
  warehouse?: { id: number; title: string };
  stats?: {
    portalPositions: number;
    roServices: number;
    roProducts: number;
    inSync: number;
    wouldUpdate: number;
    missingInRo: number;
    diffs: number;
  };
  diffs?: Array<{
    positionId: string;
    device: string;
    service: string;
    matchedService?: { id: number; title: string };
    matchedProduct?: { id: number; title: string; residue?: number | null };
    changes: Array<{
      field: string;
      portalValue: number | string | null;
      remonlineValue: number | string | null;
      action: "would_update" | "in_sync" | "missing_in_ro";
    }>;
  }>;
};

export function SyncPanel() {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/remonline/test", { cache: "no-store" });
      setTest(await res.json());
    } catch (err) {
      setTest({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const runDryRun = async () => {
    setRunning(true);
    setDryRun(null);
    try {
      const res = await fetch("/api/remonline/dry-run", { method: "POST" });
      setDryRun(await res.json());
    } catch (err) {
      setDryRun({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition hover:border-foreground/40"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Синхронизация
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex" role="dialog">
          <button
            type="button"
            aria-label="Закрыть"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
          />
          <aside className="relative ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl">
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Синхронизация с Remonline</h2>
                <p className="text-xs text-muted-foreground">
                  Сухой прогон — без записи. Только покажу разницу.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-5">
              <Section title="Шаг 1. Проверка подключения">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={testing}
                    className="flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition hover:bg-foreground/85 disabled:opacity-50"
                  >
                    {testing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                    {testing ? "Проверяю…" : "Проверить токен"}
                  </button>
                </div>
                {test && (
                  <div className="mt-3">
                    {test.ok ? (
                      <div className="rounded-lg border border-money/30 bg-money-muted px-4 py-3 text-sm">
                        <div className="flex items-center gap-2 font-medium text-money">
                          <CheckCircle2 className="h-4 w-4" />
                          Подключение работает
                        </div>
                        <dl className="mt-2 space-y-1 text-xs text-foreground">
                          <KV
                            label="Складов"
                            value={`${test.warehouses?.length ?? 0}`}
                          />
                          {test.warehouses?.[0] && (
                            <KV
                              label="Первый склад"
                              value={`${test.warehouses[0].title} (id ${test.warehouses[0].id})`}
                            />
                          )}
                          <KV
                            label="Услуг в РО"
                            value={`${test.servicesCount ?? 0}`}
                          />
                        </dl>
                        {test.productsSample && test.productsSample.length > 0 && (
                          <div className="mt-3 space-y-1 text-xs">
                            <div className="text-muted-foreground">
                              Пример товаров:
                            </div>
                            {test.productsSample.map((p) => (
                              <div
                                key={p.id}
                                className="flex items-center gap-2 truncate font-mono text-[11px] text-foreground"
                              >
                                <Box className="h-3 w-3 shrink-0 text-muted-foreground" />
                                {p.title}
                                {p.article && (
                                  <span className="text-muted-foreground">
                                    · {p.article}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <ErrorBox message={test.error ?? "Неизвестная ошибка"} />
                    )}
                  </div>
                )}
              </Section>

              <div className="my-5 h-px bg-border" />

              <Section title="Шаг 2. Сухой прогон по всем позициям">
                <p className="mb-3 text-xs text-muted-foreground">
                  Портал тянет услуги и товары из РО, сопоставляет с
                  каталогом по нормализованному наименованию и считает разницу.
                  Запись в Remonline НЕ происходит.
                </p>
                <button
                  type="button"
                  onClick={runDryRun}
                  disabled={running || !test?.ok}
                  className="flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition hover:bg-foreground/85 disabled:opacity-50"
                  title={
                    test?.ok
                      ? undefined
                      : "Сначала пройдите проверку подключения"
                  }
                >
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {running ? "Сравниваю…" : "Запустить сухой прогон"}
                </button>

                {dryRun && (
                  <div className="mt-4">
                    {dryRun.ok ? (
                      <DryRunReport result={dryRun} />
                    ) : (
                      <ErrorBox message={dryRun.error ?? "Неизвестная ошибка"} />
                    )}
                  </div>
                )}
              </Section>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-xs text-amber-900">
      <div className="flex items-center gap-2 font-medium">
        <AlertCircle className="h-4 w-4" />
        Ошибка
      </div>
      <p className="mt-1 break-words">{message}</p>
    </div>
  );
}

function DryRunReport({ result }: { result: DryRunResult }) {
  if (!result.stats) return null;
  const s = result.stats;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Позиций в портале" value={s.portalPositions} />
        <Stat label="Услуг в РО" value={s.roServices} />
        <Stat label="Товаров в РО" value={s.roProducts} />
        <Stat label="Будут обновлены" value={s.wouldUpdate} accent="flow" />
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Склад</span>
          <span className="font-mono">
            {result.warehouse?.title} (id {result.warehouse?.id})
          </span>
        </div>
      </div>

      {result.diffs && result.diffs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground">
            Разница ({result.diffs.length}
            {s.diffs > 200 ? ", показаны первые 200" : ""})
          </div>
          {result.diffs.map((d) => (
            <div
              key={d.positionId}
              className="rounded-lg border border-border bg-card p-3 text-xs"
            >
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <div className="font-medium">
                  {d.device} · {d.service}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {d.positionId.slice(0, 30)}…
                </div>
              </div>
              <div className="mb-2 flex flex-wrap gap-2 text-[10px]">
                {d.matchedService && (
                  <span className="flex items-center gap-1 rounded-full bg-flow-muted px-2 py-0.5 font-mono text-flow">
                    <Wrench className="h-2.5 w-2.5" />
                    Услуга #{d.matchedService.id}
                  </span>
                )}
                {d.matchedProduct && (
                  <span className="flex items-center gap-1 rounded-full bg-flow-muted px-2 py-0.5 font-mono text-flow">
                    <Box className="h-2.5 w-2.5" />
                    Товар #{d.matchedProduct.id}
                    {typeof d.matchedProduct.residue === "number" && (
                      <span>· {d.matchedProduct.residue} шт</span>
                    )}
                  </span>
                )}
              </div>
              <ul className="space-y-1">
                {d.changes.map((c, i) => (
                  <li
                    key={i}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1 font-mono text-[11px]",
                      c.action === "would_update" && "bg-flow-muted text-flow",
                      c.action === "missing_in_ro" &&
                        "bg-amber-50 text-amber-900",
                      c.action === "in_sync" &&
                        "bg-money-muted text-money",
                    )}
                  >
                    <span className="min-w-[100px]">{c.field}</span>
                    <span>{format(c.portalValue)}</span>
                    <ArrowRight className="h-3 w-3 opacity-60" />
                    <span>{format(c.remonlineValue)}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wider opacity-70">
                      {c.action === "would_update"
                        ? "обновим"
                        : c.action === "missing_in_ro"
                          ? "нет в РО"
                          : "ок"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "flow";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2",
        accent === "flow" ? "border-flow/40 bg-flow-muted" : "border-border",
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          accent === "flow" && "text-flow",
        )}
      >
        {value.toLocaleString("ru-RU")}
      </div>
    </div>
  );
}

function format(v: number | string | null) {
  if (v === null) return "—";
  if (typeof v === "number") return v.toLocaleString("ru-RU");
  return v;
}
