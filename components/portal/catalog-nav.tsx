"use client";

import { useMemo, useState } from "react";
import { Search, Plus, ChevronDown, Smartphone } from "lucide-react";
import type { Position } from "@/lib/portal-types";
import { groupCatalog } from "@/lib/portal-catalog";
import { cn } from "@/lib/utils";

type Props = {
  positions: Position[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function CatalogNav({ positions, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? positions.filter((p) =>
          [p.device, p.category, p.variant, p.code]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : positions;
    return groupCatalog(filtered);
  }, [positions, query]);

  return (
    <aside className="hidden w-72 shrink-0 lg:block">
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

        <nav className="-mr-1 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
          {groups.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              Ничего не найдено
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {groups.map((group) => {
              const isCollapsed = collapsed[group.device] ?? false;
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
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {group.positions.map((p) => {
                        const isActive = p.id === selectedId;
                        const finalCell = p.stages
                          .flatMap((s) => s.cells)
                          .find((c) => c.isFinal);
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
                                  {p.category}
                                </span>
                                <span
                                  className={cn(
                                    "block truncate text-[11px] leading-tight",
                                    isActive
                                      ? "text-background/70"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {p.variant}
                                </span>
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
                                {finalCell?.value
                                  ? `${finalCell.value.toLocaleString("ru-RU")} ₽`
                                  : "—"}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-1 rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Реальный список загрузится из{" "}
          <span className="font-mono text-foreground">БД_УСЛУГИ_РО</span> +{" "}
          <span className="font-mono text-foreground">БД_ЗАПЧАСТИ</span>, когда вы пришлёте XLSX.
        </div>
      </div>
    </aside>
  );
}
