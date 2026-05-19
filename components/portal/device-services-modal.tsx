"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, PackageSearch, X } from "lucide-react";
import type { PositionStub } from "@/lib/portal-types";
import { PRICING_FINGERPRINTS } from "@/lib/portal-catalog";
import { useRemonline, type StockReading } from "@/lib/remonline/context";
import { getServiceBucket } from "./catalog-filters";
import { cn } from "@/lib/utils";

type Props = {
  device: string | null;
  positions: PositionStub[];
  onClose: () => void;
  onSelectPosition: (id: string) => void;
};

/**
 * Цветовая «лента» для группы узлов телефона.
 */
type BandTone = "emerald" | "sky" | "amber" | "rose" | "slate";

const BAND_BY_BUCKET: Record<string, BandTone> = {
  Дисплей: "amber",
  Аккумулятор: "sky",
  Камера: "rose",
  "Корпус / крышка": "rose",
  "Разъём зарядки": "sky",
  Кнопки: "slate",
  Динамики: "sky",
  Микрофон: "sky",
  "Плата / связь": "slate",
  "Прочие услуги": "slate",
};

const BAND_CLASS: Record<BandTone, { row: string; chip: string }> = {
  emerald: {
    row: "bg-emerald-50/70 hover:bg-emerald-50",
    chip: "bg-emerald-100 text-emerald-900",
  },
  sky: {
    row: "bg-sky-50/70 hover:bg-sky-50",
    chip: "bg-sky-100 text-sky-900",
  },
  amber: {
    row: "bg-amber-50/70 hover:bg-amber-50",
    chip: "bg-amber-100 text-amber-900",
  },
  rose: {
    row: "bg-rose-50/70 hover:bg-rose-50",
    chip: "bg-rose-100 text-rose-900",
  },
  slate: {
    row: "bg-slate-50/70 hover:bg-slate-100",
    chip: "bg-slate-200 text-slate-800",
  },
};

function bucketForRow(p: PositionStub, retailPrice: number | null): {
  label: string;
  tone: BandTone;
} {
  const cat = p.category.toLowerCase();
  if (
    retailPrice === 0 ||
    cat.includes("диагностик") ||
    cat.includes("чистк")
  ) {
    return { label: "Диагностика и чистка", tone: "emerald" };
  }
  const bucket = getServiceBucket(p.category);
  return { label: bucket, tone: BAND_BY_BUCKET[bucket] ?? "slate" };
}

/**
 * Прогон через простой пул конкурентности: запускаем максимум `limit`
 * задач параллельно и ждём, пока всё закончится. Нужно, чтобы при
 * клике «Запросить остатки» по группе из 6 запчастей мы не лупили в
 * РО все 6 одновременно × N складов — а делали по 4 за раз.
 */
async function runWithLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, tasks.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = cursor++;
        if (i >= tasks.length) return;
        results[i] = await tasks[i]();
      }
    });
  await Promise.all(workers);
  return results;
}

/** Короткое название склада для подписи под количеством. */
function shortWarehouse(title: string | undefined): string {
  if (!title) return "";
  // «Максмобайлс > Склад Сервис» → «Склад Сервис»
  const tail = title.split(">").pop()?.trim();
  return tail || title;
}

/**
 * Сводка по live-остатку: сколько штук всего и где лежит большинство.
 * Берём склад с максимальным остатком — этого достаточно для подписи
 * в строке таблицы. Если складов несколько — добавляем «+N».
 */
function summarizeStock(
  reading: StockReading | undefined,
): { qty: number; label: string } | null {
  if (!reading || !reading.found) return null;
  const total = reading.quantity;
  const per = reading.perWarehouse?.filter((w) => w.quantity > 0) ?? [];
  if (per.length === 0) return { qty: total, label: "" };
  const sorted = [...per].sort((a, b) => b.quantity - a.quantity);
  const top = sorted[0];
  const rest = sorted.length - 1;
  const label =
    rest > 0
      ? `${shortWarehouse(top.warehouseTitle)} +${rest}`
      : shortWarehouse(top.warehouseTitle);
  return { qty: total, label };
}

export function DeviceServicesModal({
  device,
  positions,
  onClose,
  onSelectPosition,
}: Props) {
  // Esc для закрытия
  useEffect(() => {
    if (!device) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [device, onClose]);

  // Карта позицийId → fingerprint, чтобы быстро доставать цены и id запчасти
  const fingerprintById = useMemo(() => {
    const map = new Map<string, (typeof PRICING_FINGERPRINTS)[number]>();
    for (const fp of PRICING_FINGERPRINTS) map.set(fp.positionId, fp);
    return map;
  }, []);

  const { stockByKey, requestStock } = useRemonline();

  // Какие группы сейчас «в работе» — для крутилки на кнопке.
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null);

  // Все позиции выбранной модели + раскладка по бакетам
  const grouped = useMemo(() => {
    if (!device) return [];
    const rows = positions
      .filter((p) => p.device === device)
      .map((p) => {
        const fp = fingerprintById.get(p.id);
        const partRetail = fp?.partRetail ?? null;
        const laborPrice = fp?.laborPrice ?? null;
        const bucket = bucketForRow(p, p.finalPrice);
        return { p, fp, partRetail, laborPrice, bucket };
      });

    const order: string[] = [];
    const byBucket = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!byBucket.has(r.bucket.label)) {
        order.push(r.bucket.label);
        byBucket.set(r.bucket.label, []);
      }
      byBucket.get(r.bucket.label)!.push(r);
    }
    return order.map((label) => ({
      label,
      tone: byBucket.get(label)![0].bucket.tone,
      rows: byBucket.get(label)!,
    }));
  }, [device, positions, fingerprintById]);

  if (!device) return null;

  const totalRows = grouped.reduce((sum, g) => sum + g.rows.length, 0);

  // Запрос остатков по всей группе: берём только те строки, у которых
  // есть запчасть и хоть один идентификатор; для пустых — просто скип.
  const requestGroupStock = async (groupLabel: string) => {
    const group = grouped.find((g) => g.label === groupLabel);
    if (!group) return;
    setLoadingGroup(groupLabel);
    const tasks: Array<() => Promise<unknown>> = [];
    for (const r of group.rows) {
      const fp = r.fp;
      if (!fp?.roPartKey) continue;
      const hasAnyId = !!(
        fp.partProductId ||
        fp.partCode ||
        fp.partArticle ||
        fp.partBarcode
      );
      if (!hasAnyId) continue;
      tasks.push(() =>
        requestStock(fp.roPartKey!, {
          partArticle: fp.partArticle,
          partProductId: fp.partProductId,
          partCode: fp.partCode,
          partBarcode: fp.partBarcode,
        }),
      );
    }
    try {
      await runWithLimit(tasks, 4);
    } finally {
      setLoadingGroup(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Услуги для ${device}`}
      >
        {/* Шапка модалки */}
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {device}
            </h2>
            <span className="text-xs text-muted-foreground">
              {totalRows} услуг
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Шапка таблицы */}
        <div className="grid grid-cols-[1fr_110px_140px_110px] gap-2 border-b border-border bg-card/60 px-5 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <div>Наименование работы</div>
          <div className="text-right">Розница</div>
          <div className="text-right">Запчасть ₽</div>
          <div className="text-right">Работа ₽</div>
        </div>

        {/* Тело таблицы */}
        <div className="flex-1 overflow-y-auto">
          {grouped.map((group) => {
            // Кнопка имеет смысл только если в группе есть хоть одна
            // запчасть с идентификатором — иначе на эндпоинт нечего слать.
            const groupHasParts = group.rows.some((r) => {
              const fp = r.fp;
              return (
                fp?.roPartKey &&
                !!(
                  fp.partProductId ||
                  fp.partCode ||
                  fp.partArticle ||
                  fp.partBarcode
                )
              );
            });
            const isLoading = loadingGroup === group.label;
            return (
              <div key={group.label}>
                <div
                  className={cn(
                    "sticky top-0 z-10 flex items-center gap-2 px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider",
                    BAND_CLASS[group.tone].chip,
                  )}
                >
                  <span>{group.label}</span>
                  <span className="font-mono text-[10px] opacity-60">
                    · {group.rows.length}
                  </span>
                  {groupHasParts && (
                    <button
                      type="button"
                      onClick={() => requestGroupStock(group.label)}
                      disabled={isLoading}
                      className={cn(
                        "ml-auto inline-flex items-center gap-1 rounded-md border border-current/20 bg-background/70 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal transition",
                        "hover:bg-background disabled:opacity-60",
                      )}
                      aria-label={`Запросить остатки для группы ${group.label}`}
                    >
                      {isLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <PackageSearch className="h-3 w-3" />
                      )}
                      <span>
                        {isLoading ? "Запрашиваем…" : "Запросить остатки"}
                      </span>
                    </button>
                  )}
                </div>
                <ul>
                  {group.rows.map(({ p, fp, partRetail, laborPrice }) => {
                    const title =
                      [p.category, p.variant].filter(Boolean).join(" — ") ||
                      p.category;
                    const stock = fp?.roPartKey
                      ? summarizeStock(stockByKey.get(fp.roPartKey))
                      : null;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPosition(p.id);
                            onClose();
                          }}
                          className={cn(
                            "grid w-full grid-cols-[1fr_110px_140px_110px] items-start gap-2 border-b border-border/40 px-5 py-2 text-left text-sm transition",
                            BAND_CLASS[group.tone].row,
                          )}
                        >
                          <span className="min-w-0 truncate text-[13px] text-foreground">
                            {title}
                          </span>
                          <span className="text-right font-mono text-[12px] tabular-nums text-money">
                            {p.finalPrice
                              ? `${p.finalPrice.toLocaleString("ru-RU")} ₽`
                              : "—"}
                          </span>
                          <span className="flex flex-col items-end leading-tight">
                            <span className="font-mono text-[12px] tabular-nums text-foreground/70">
                              {partRetail
                                ? partRetail.toLocaleString("ru-RU")
                                : "—"}
                            </span>
                            {stock && stock.qty > 0 && (
                              <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                                <span className="tabular-nums">
                                  {stock.qty} шт
                                </span>
                                {stock.label && (
                                  <span className="font-normal opacity-80">
                                    · {stock.label}
                                  </span>
                                )}
                              </span>
                            )}
                            {stock && stock.qty === 0 && (
                              <span className="mt-0.5 text-[10px] text-muted-foreground">
                                нет на складе
                              </span>
                            )}
                          </span>
                          <span className="text-right font-mono text-[12px] font-semibold tabular-nums text-foreground">
                            {laborPrice
                              ? laborPrice.toLocaleString("ru-RU")
                              : "—"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <footer className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
          Клик по строке — открыть полную карточку услуги. Кнопка
          «Запросить остатки» в шапке группы тянет актуальный остаток
          по каждой запчасти из Remonline.
        </footer>
      </div>
    </div>
  );
}
