"use client";

import { useMemo, useState } from "react";
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Database,
  Wrench,
  Box,
  CircleAlert,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRemonline } from "@/lib/remonline/context";

type TestResult = {
  ok: boolean;
  error?: string;
  warehouses?: Array<{ id: number; title: string }>;
  servicesCount?: number;
  productsSample?: Array<{ id: number; title: string; article?: string | null }>;
};

export function SyncPanel() {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const {
    services,
    products,
    loadingServices,
    loadingProducts,
    errorServices,
    errorProducts,
    loadServices,
    loadProducts,
    conflictByDevice,
  } = useRemonline();

  // Общая сводка по всем устройствам
  const totals = useMemo(() => {
    let labor = 0;
    let part = 0;
    for (const v of conflictByDevice.values()) {
      labor += v.laborConflicts;
      part += v.partConflicts;
    }
    return { labor, part, devices: conflictByDevice.size };
  }, [conflictByDevice]);

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

  // Бейдж в шапке кнопки — суммарное число расхождений
  const badge = totals.labor + totals.part;
  const indicatorColor =
    badge > 0 ? "bg-rose-500" : services || products ? "bg-emerald-500" : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition hover:border-foreground/40"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Синхронизация
        {indicatorColor && (
          <span
            className={cn(
              "ml-1 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums text-white",
              indicatorColor,
            )}
          >
            {badge > 0 ? badge : "✓"}
          </span>
        )}
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
                <h2 className="text-base font-semibold">
                  Синхронизация с Remonline
                </h2>
                <p className="text-xs text-muted-foreground">
                  Загрузите snapshot — портал покажет расхождения по каждой
                  ячейке. Запись по кнопке.
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
              <Section title="Подключение">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={testing}
                    className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium transition hover:border-foreground/40 disabled:opacity-50"
                  >
                    {testing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                    {testing ? "Проверяю…" : "Проверить токен"}
                  </button>
                  {test?.ok && (
                    <span className="flex items-center gap-1 rounded-full border border-money/30 bg-money-muted px-2 py-1 text-[11px] font-medium text-money">
                      <CheckCircle2 className="h-3 w-3" />
                      OK · {test.warehouses?.length ?? 0} складов
                    </span>
                  )}
                </div>
                {test && !test.ok && (
                  <ErrorBox message={test.error ?? "Неизвестная ошибка"} />
                )}
              </Section>

              <div className="my-5 h-px bg-border" />

              <Section title="Snapshot">
                <p className="mb-3 text-xs text-muted-foreground">
                  Каждая кнопка тянет полный список из РО и сравнивает с
                  каталогом портала по нормализованному имени. Расхождения
                  подсветятся красным восклицательным знаком прямо в позициях.
                </p>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SnapshotButton
                    label="Цены работ"
                    icon={Wrench}
                    loading={loadingServices}
                    error={errorServices}
                    snapshot={services}
                    conflicts={totals.labor}
                    onLoad={loadServices}
                  />
                  <SnapshotButton
                    label="Цены запчастей"
                    icon={Box}
                    loading={loadingProducts}
                    error={errorProducts}
                    snapshot={products}
                    conflicts={totals.part}
                    onLoad={loadProducts}
                  />
                </div>
              </Section>

              {(services || products) && (
                <>
                  <div className="my-5 h-px bg-border" />
                  <Section title="Сводка по моделям">
                    <DeviceConflictSummary
                      conflictByDevice={conflictByDevice}
                    />
                  </Section>
                </>
              )}
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

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-xs text-amber-900">
      <div className="flex items-center gap-2 font-medium">
        <AlertCircle className="h-4 w-4" />
        Ошибка
      </div>
      <p className="mt-1 break-words">{message}</p>
    </div>
  );
}

function SnapshotButton({
  label,
  icon: Icon,
  loading,
  error,
  snapshot,
  conflicts,
  onLoad,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
  error: string | null;
  snapshot: { takenAt: string; total: number } | null;
  conflicts: number;
  onLoad: () => void;
}) {
  const takenAtDelta = snapshot
    ? formatDelta(new Date(snapshot.takenAt))
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{label}</span>
        {snapshot && (
          <span
            className={cn(
              "ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
              conflicts > 0
                ? "bg-rose-100 text-rose-700"
                : "bg-money-muted text-money",
            )}
          >
            {conflicts > 0 ? (
              <>
                <CircleAlert className="h-2.5 w-2.5" />
                {conflicts} расхождений
              </>
            ) : (
              <>
                <CheckCircle2 className="h-2.5 w-2.5" />в синхроне
              </>
            )}
          </span>
        )}
      </div>

      {snapshot && (
        <dl className="mt-3 space-y-1 text-[11px]">
          <KV label="В РО" value={snapshot.total.toLocaleString("ru-RU")} />
          <KV
            label="Загружено"
            value={
              <span className="flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {takenAtDelta}
              </span>
            }
          />
        </dl>
      )}

      <button
        type="button"
        onClick={onLoad}
        disabled={loading}
        className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-xs font-medium text-background transition hover:bg-foreground/85 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {loading
          ? "Загружаю…"
          : snapshot
            ? "Обновить"
            : `Проверить ${label.toLowerCase()}`}
      </button>

      {error && <ErrorBox message={error} />}
    </div>
  );
}

function DeviceConflictSummary({
  conflictByDevice,
}: {
  conflictByDevice: Map<
    string,
    { laborConflicts: number; partConflicts: number; total: number }
  >;
}) {
  const list = useMemo(() => {
    return [...conflictByDevice.entries()]
      .filter(([, v]) => v.total > 0)
      .sort((a, b) => b[1].total - a[1].total);
  }, [conflictByDevice]);

  if (list.length === 0) {
    return (
      <div className="rounded-lg border border-money/30 bg-money-muted px-4 py-3 text-sm text-money">
        <CheckCircle2 className="mr-2 inline h-4 w-4" />
        Все цены в синхроне с Remonline.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {list.map(([device, v]) => (
        <li
          key={device}
          className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-xs"
        >
          <span className="font-medium text-foreground">{device}</span>
          <span className="flex items-center gap-2 text-rose-700">
            {v.laborConflicts > 0 && (
              <span className="flex items-center gap-1 font-mono">
                <Wrench className="h-3 w-3" />
                {v.laborConflicts}
              </span>
            )}
            {v.partConflicts > 0 && (
              <span className="flex items-center gap-1 font-mono">
                <Box className="h-3 w-3" />
                {v.partConflicts}
              </span>
            )}
            <span className="rounded-full bg-rose-100 px-1.5 py-0.5 font-bold tabular-nums">
              {v.total}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function KV({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-muted-foreground">
      <dt>{label}</dt>
      <dd className="font-mono text-foreground">{value}</dd>
    </div>
  );
}

function formatDelta(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "только что";
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч назад`;
  return d.toLocaleString("ru-RU");
}
