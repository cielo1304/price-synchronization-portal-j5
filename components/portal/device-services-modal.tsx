"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import type { PositionStub } from "@/lib/portal-types";
import { PRICING_FINGERPRINTS } from "@/lib/portal-catalog";
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
 * 5 пастельных оттенков — каждый отвечает за крупную область:
 *   emerald — бесплатные/диагностика/чистка
 *   sky     — питание и звук (аккум, динамики, микрофон, разъёмы, зарядка)
 *   amber   — дисплей и стекло
 *   rose    — оптика и корпус (камеры, крышка)
 *   slate   — софт и плата (прошивка, Face ID, плата, Wi-Fi)
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

/** Обёртка над getServiceBucket: бесплатные услуги уезжают в emerald. */
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

  // Карта позицийId → fingerprint, чтобы быстро доставать цены запчасти/работы
  const fingerprintById = useMemo(() => {
    const map = new Map<string, (typeof PRICING_FINGERPRINTS)[number]>();
    for (const fp of PRICING_FINGERPRINTS) map.set(fp.positionId, fp);
    return map;
  }, []);

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
        return { p, partRetail, laborPrice, bucket };
      });

    // Группируем по bucket.label, сохраняя порядок первого появления
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
        <div className="grid grid-cols-[1fr_110px_110px_110px] gap-2 border-b border-border bg-card/60 px-5 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <div>Наименование работы</div>
          <div className="text-right">Розница</div>
          <div className="text-right">Запчасть ₽</div>
          <div className="text-right">Работа ₽</div>
        </div>

        {/* Тело таблицы */}
        <div className="flex-1 overflow-y-auto">
          {grouped.map((group) => (
            <div key={group.label}>
              <div
                className={cn(
                  "sticky top-0 z-10 flex items-center gap-2 px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider",
                  BAND_CLASS[group.tone].chip,
                )}
              >
                {group.label}
                <span className="font-mono text-[10px] opacity-60">
                  · {group.rows.length}
                </span>
              </div>
              <ul>
                {group.rows.map(({ p, partRetail, laborPrice }) => {
                  const title =
                    [p.category, p.variant].filter(Boolean).join(" — ") ||
                    p.category;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectPosition(p.id);
                          onClose();
                        }}
                        className={cn(
                          "grid w-full grid-cols-[1fr_110px_110px_110px] items-center gap-2 border-b border-border/40 px-5 py-2 text-left text-sm transition",
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
                        <span className="text-right font-mono text-[12px] tabular-nums text-foreground/70">
                          {partRetail
                            ? partRetail.toLocaleString("ru-RU")
                            : "—"}
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
          ))}
        </div>

        <footer className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
          Клик по строке — открыть полную карточку услуги
        </footer>
      </div>
    </div>
  );
}
