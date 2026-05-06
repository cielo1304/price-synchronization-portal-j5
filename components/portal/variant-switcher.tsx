"use client";

import type { PartVariant } from "@/lib/portal-types";
import { cn } from "@/lib/utils";
import { Layers } from "lucide-react";

type Props = {
  variants: PartVariant[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function VariantSwitcher({ variants, selectedId, onSelect }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Вариант исполнения запчасти
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">
          выбор меняет источники, наценку и конечную цену
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {variants.map((v) => {
          const isActive = v.id === selectedId;
          const hasPrice = v.sources.some((s) => s.price !== null);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v.id)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-xs transition",
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:border-foreground/40",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{v.shortName}</span>
                {!hasPrice && (
                  <span
                    className={cn(
                      "rounded px-1 py-0.5 text-[9px] uppercase tracking-wide",
                      isActive
                        ? "bg-background/20 text-background"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    нет данных
                  </span>
                )}
              </div>
              <div
                className={cn(
                  "mt-0.5 font-mono text-[10px]",
                  isActive ? "text-background/70" : "text-muted-foreground",
                )}
              >
                наценка {Math.round(v.markupPct * 1000) / 10}%
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
