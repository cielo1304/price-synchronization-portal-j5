"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { ChevronDown, X, Check, Filter } from "lucide-react";
import type { PositionStub } from "@/lib/portal-types";
import { cn } from "@/lib/utils";

export type CatalogFilters = {
  generations: Set<string>;
  models: Set<string>;
  services: Set<string>;
};

export const EMPTY_FILTERS: CatalogFilters = {
  generations: new Set(),
  models: new Set(),
  services: new Set(),
};

// ── Утилиты бакетирования ────────────────────────────────────────────────

/** Сводим точное название модели к поколению: «iPhone 16 Pro Max» → «iPhone 16» */
export function getGeneration(device: string): string {
  if (/iPhone\s+SE/i.test(device)) return "iPhone SE";
  if (/iPhone\s+X(?!\d)/i.test(device)) return "iPhone X-серия";
  const m = device.match(/iPhone\s+(\d+E?)/i);
  return m ? `iPhone ${m[1]}` : device;
}

/** Сортировка поколений: новые сверху, SE — внизу */
function generationSortKey(gen: string): number {
  if (gen === "iPhone SE") return -1;
  if (gen === "iPhone X-серия") return 10.5;
  const m = gen.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Превращаем длинное название категории в один из ~13 типов услуг */
export function getServiceBucket(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("дисплей")) return "Дисплей";
  if (c.includes("аккумулятор")) return "Аккумулятор";
  if (c.includes("камер")) return "Камера";
  if (c.includes("корпус") || c.includes("крышк")) return "Корпус / крышка";
  if (c.includes("разъем") || c.includes("разъём")) return "Разъём зарядки";
  if (c.includes("кнопк")) return "Кнопки";
  if (c.includes("динамик")) return "Динамики";
  if (c.includes("микрофон")) return "Микрофон";
  if (
    c.includes("плат") ||
    c.includes("модем") ||
    c.includes("wifi") ||
    c.includes("bluetooth")
  )
    return "Плата · GSM · Wi-Fi";
  if (c.includes("face id") || c.includes("faceid")) return "Face ID";
  if (c.includes("пылевлаг")) return "Пылевлагозащита";
  if (c.includes("чистк") || c.includes("профилактик")) return "Чистка · профилактика";
  if (c.includes("диагност")) return "Диагностика";
  return "Прочее";
}

const SERVICE_ORDER = [
  "Дисплей",
  "Аккумулятор",
  "Камера",
  "Корпус / крышка",
  "Разъём зарядки",
  "Кнопки",
  "Динамики",
  "Микрофон",
  "Плата · GSM · Wi-Fi",
  "Face ID",
  "Пылевлагозащита",
  "Чистка · профилактика",
  "Диагностика",
  "Прочее",
];

// ── Фильтрация ───────────────────────────────────────────────────────────

export function applyFilters(
  positions: PositionStub[],
  filters: CatalogFilters,
): PositionStub[] {
  const { generations, models, services } = filters;
  const hasGen = generations.size > 0;
  const hasModel = models.size > 0;
  const hasService = services.size > 0;
  if (!hasGen && !hasModel && !hasService) return positions;

  return positions.filter((p) => {
    if (hasModel && !models.has(p.device)) return false;
    if (hasGen && !generations.has(getGeneration(p.device))) return false;
    if (hasService && !services.has(getServiceBucket(p.category))) return false;
    return true;
  });
}

// ── Подсчёт опций по живому каталогу ─────────────────────────────────────

type Option = { value: string; count: number };

function countByKey(
  positions: PositionStub[],
  keyFn: (p: PositionStub) => string,
): Option[] {
  const counts = new Map<string, number>();
  for (const p of positions) {
    const k = keyFn(p);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([value, count]) => ({
    value,
    count,
  }));
}

// ── Компонент ────────────────────────────────────────────────────────────

type Props = {
  positions: PositionStub[];
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
};

export function CatalogFiltersBar({ positions, filters, onChange }: Props) {
  const generationOptions = useMemo(
    () =>
      countByKey(positions, (p) => getGeneration(p.device)).sort(
        (a, b) => generationSortKey(b.value) - generationSortKey(a.value),
      ),
    [positions],
  );

  // Модели — учитываем выбранные поколения, чтобы список был релевантным
  const modelOptions = useMemo(() => {
    const filtered =
      filters.generations.size > 0
        ? positions.filter((p) =>
            filters.generations.has(getGeneration(p.device)),
          )
        : positions;
    return countByKey(filtered, (p) => p.device).sort((a, b) =>
      a.value.localeCompare(b.value, "ru"),
    );
  }, [positions, filters.generations]);

  const serviceOptions = useMemo(() => {
    const all = countByKey(positions, (p) => getServiceBucket(p.category));
    const indexOf = (v: string) => {
      const i = SERVICE_ORDER.indexOf(v);
      return i === -1 ? 999 : i;
    };
    return all.sort((a, b) => indexOf(a.value) - indexOf(b.value));
  }, [positions]);

  const totalActive =
    filters.generations.size + filters.models.size + filters.services.size;

  const toggleIn = (set: Set<string>, v: string): Set<string> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterDropdown
          label="Поколение"
          icon={<Filter className="h-3 w-3" />}
          selected={filters.generations}
          options={generationOptions}
          onToggle={(v) =>
            onChange({
              ...filters,
              generations: toggleIn(filters.generations, v),
              // если меняется поколение, чистим модели вне поколений
              models: new Set(
                Array.from(filters.models).filter((m) => {
                  const next = toggleIn(filters.generations, v);
                  return next.size === 0 || next.has(getGeneration(m));
                }),
              ),
            })
          }
          onClear={() =>
            onChange({ ...filters, generations: new Set(), models: new Set() })
          }
        />
        <FilterDropdown
          label="Модель"
          selected={filters.models}
          options={modelOptions}
          onToggle={(v) =>
            onChange({ ...filters, models: toggleIn(filters.models, v) })
          }
          onClear={() => onChange({ ...filters, models: new Set() })}
        />
        <FilterDropdown
          label="Услуга"
          selected={filters.services}
          options={serviceOptions}
          onToggle={(v) =>
            onChange({ ...filters, services: toggleIn(filters.services, v) })
          }
          onClear={() => onChange({ ...filters, services: new Set() })}
        />
        {totalActive > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            className="ml-auto text-[11px] text-muted-foreground transition hover:text-foreground"
          >
            Сбросить всё
          </button>
        )}
      </div>

      {totalActive > 0 && (
        <div className="flex flex-wrap gap-1">
          {Array.from(filters.generations).map((v) => (
            <ActivePill
              key={"g-" + v}
              label={v}
              onRemove={() =>
                onChange({
                  ...filters,
                  generations: toggleIn(filters.generations, v),
                })
              }
            />
          ))}
          {Array.from(filters.models).map((v) => (
            <ActivePill
              key={"m-" + v}
              label={v}
              onRemove={() =>
                onChange({ ...filters, models: toggleIn(filters.models, v) })
              }
            />
          ))}
          {Array.from(filters.services).map((v) => (
            <ActivePill
              key={"s-" + v}
              label={v}
              onRemove={() =>
                onChange({
                  ...filters,
                  services: toggleIn(filters.services, v),
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Кнопка-выпадайка с чек-боксами ───────────────────────────────────────

function FilterDropdown({
  label,
  icon,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  icon?: React.ReactNode;
  options: Option[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = selected.size;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition",
          count > 0
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background text-foreground/80 hover:border-foreground",
        )}
      >
        {icon}
        <span>{label}</span>
        {count > 0 && (
          <span
            className={cn(
              "rounded-full px-1.5 py-px text-[10px] tabular-nums",
              count > 0 ? "bg-background/20 text-background" : "",
            )}
          >
            {count}
          </span>
        )}
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
          {count > 0 && (
            <button
              type="button"
              onClick={() => onClear()}
              className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            >
              Очистить · {count}
              <X className="h-3 w-3" />
            </button>
          )}
          <ul className="flex flex-col">
            {options.map((opt) => {
              const checked = selected.has(opt.value);
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => onToggle(opt.value)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition",
                      checked
                        ? "bg-muted text-foreground"
                        : "text-foreground/80 hover:bg-muted/60",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-foreground bg-foreground text-background"
                            : "border-border",
                        )}
                      >
                        {checked && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <span className="truncate">{opt.value}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {opt.count}
                    </span>
                  </button>
                </li>
              );
            })}
            {options.length === 0 && (
              <li className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                Нет вариантов
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActivePill({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-foreground/80">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full text-muted-foreground hover:text-foreground"
        aria-label={`Убрать фильтр ${label}`}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
