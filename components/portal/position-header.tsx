import type { Position } from "@/lib/portal-types";
import { ChevronRight, Smartphone, ShieldCheck, Clock } from "lucide-react";

type Props = {
  position: Position;
};

export function PositionHeader({ position }: Props) {
  const finalCell = position.stages
    .flatMap((s) => s.cells)
    .find((c) => c.isFinal);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>{position.device}</span>
            <ChevronRight className="h-3 w-3" />
            <span>{position.category}</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">{position.variant}</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground text-balance">
            {position.serviceName}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{position.code}</span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              {position.warranty}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {position.laborMinutes} мин
            </span>
            {position.draft && (
              <span className="rounded-full border border-dashed border-foreground/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground/70">
                черновик
              </span>
            )}
          </div>
        </div>
      </div>

      {finalCell && finalCell.value !== null && (
        <div className="flex items-center gap-3 rounded-xl border border-money/40 bg-money-muted px-4 py-3">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Конечная цена
            </div>
            <div className="text-2xl font-semibold tabular-nums text-money">
              {finalCell.value.toLocaleString("ru-RU")} ₽
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
