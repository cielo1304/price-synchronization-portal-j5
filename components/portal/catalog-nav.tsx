"use client";

import { useMemo, useState } from "react";
import { Search, Plus, ChevronDown, Smartphone } from "lucide-react";
import type { PositionStub } from "@/lib/portal-types";
import { groupCatalog } from "@/lib/portal-catalog";
import {
  CatalogFiltersBar,
  EMPTY_FILTERS,
  applyFilters,
  type CatalogFilters,
} from "./catalog-filters";
import { cn } from "@/lib/utils";

type Props = {
  positions: PositionStub[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function CatalogNav({ positions, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const visible = useMemo(() => {
    const afterFilters = applyFilters(positions, filters);
    const q = query.trim().toLowerCase();
    return q
      ? afterFilters.filter((p) =>
          [p.device, p.category, p.variant, p.code]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : afterFilters;
  }, [positions, filters, query]);

  const groups = useMemo(() => groupCatalog(visible), [visible]);

  const totalActiveFilters =
    filters.generations.size + filters.models.size + filters.services.size;
  const filterActive = totalActiveFilters > 0 || query.trim().length > 0;

  return (
    <aside className="hidden w-80 shrink-0 lg:block">
      <div className="sticky top-6 flex flex-col gap-3 rounded-2xl border border-border bg-card/40 p-3">
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Каталог услуг
          </div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition hover:border-foreground hover:text-foreground"
            aria-label="Создать позицию"
            title="Создать позицию"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <CatalogFiltersBar
          positions={positions}
          filters={filters}
          onChange={setFilters}
        />

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: модель, запчасть, код"
            className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-foreground"
          />
        </div>

        <nav className="-mr-1 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
          {groups.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              Ничего не найдено
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {groups.map((group) => {
              // При активном поиске или фильтрах — раскрываем группы автоматически.
              const isCollapsed = filterActive
                ? false
                : (collapsed[group.device] ?? true);
              const byCategory = new Map<string, PositionStub[]>();
              for (const p of group.positions) {
                if (!byCategory.has(p.category))
                  byCategory.set(p.category, []);
                byCategory.get(p.category)!.push(p);
              }
              return (
                <li key={group.device}>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((prev) => ({
                        ...prev,
                        [group.device]: !isCollapsed,
                      }))
                    }
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium text-foreground/80 transition hover:bg-muted/60"
                  >
                    <span className="flex items-center gap-2">
                      <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                      {group.device}
                      <span className="text-muted-foreground">
                        · {group.positions.length}
                      </span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        isCollapsed && "-rotate-90",
                      )}
                    />
                  </button>

                  {!isCollapsed && (
                    <div className="mt-1 flex flex-col gap-2.5">
                      {Array.from(byCategory.entries()).map(
                        ([category, items]) => {
                          const onlyOne = items.length === 1;
                          return (
                            <div key={category} className="flex flex-col gap-1">
                              {!onlyOne && (
                                <div className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                                  {category}
                                </div>
                              )}
                              <ul className="flex flex-col gap-0.5">
                                {items.map((p) => {
                                  const isActive = p.id === selectedId;
                                  const label = onlyOne
                                    ? p.category
                                    : p.variant || p.category;
                                  const sub = onlyOne ? p.variant : null;
                                  return (
                                    <li key={p.id}>
                                      <button
                                        type="button"
                                        onClick={() => onSelect(p.id)}
                                        className={cn(
                                          "group flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition",
                                          isActive
                                            ? "bg-foreground text-background"
                                            : "text-foreground/90 hover:bg-muted/60",
                                        )}
                                      >
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-[13px] leading-tight">
                                            {label}
                                          </span>
                                          {sub && (
                                            <span
                                              className={cn(
                                                "block truncate text-[11px] leading-tight",
                                                isActive
                                                  ? "text-background/70"
                                                  : "text-muted-foreground",
                                              )}
                                            >
                                              {sub}
                                            </span>
                                          )}
                                        </span>
                                        <span
                                          className={cn(
                                            "shrink-0 font-mono text-[11px] tabular-nums",
                                            isActive
                                              ? "text-background"
                                              : p.draft
                                                ? "text-muted-foreground"
                                                : "text-money",
                                          )}
                                        >
                                          {p.finalPrice
                                            ? `${p.finalPrice.toLocaleString(
                                                "ru-RU",
                                              )} ₽`
                                            : "—"}
                                        </span>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        },
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-1 rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {visible.length.toLocaleString("ru-RU")} из{" "}
          {positions.length.toLocaleString("ru-RU")} позиций ·{" "}
          <span className="font-mono text-foreground">ПРАЙС_ЛИСТ</span>
        </div>
      </div>
    </aside>
  );
}
