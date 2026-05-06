"use client";

import { cn } from "@/lib/utils";
import type { Cell } from "@/lib/portal-types";
import { Database, Sigma, Pencil, Cpu, ArrowDownToLine, FileSpreadsheet } from "lucide-react";

const KIND_META: Record<
  Cell["kind"],
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  source: { label: "источник", icon: Database },
  auto: { label: "авто", icon: Cpu },
  manual: { label: "ручной", icon: Pencil },
  formula: { label: "формула", icon: Sigma },
  output: { label: "выгрузка", icon: ArrowDownToLine },
};

function formatValue(cell: Cell): string {
  if (cell.value === null) return "—";
  if (cell.unit === "%") return `${cell.value} %`;
  if (cell.unit === "min") return `${cell.value} мин`;
  return `${cell.value.toLocaleString("ru-RU")} ₽`;
}

type Props = {
  cell: Cell;
  selected?: boolean;
  onSelect?: (cell: Cell) => void;
};

export function CellCard({ cell, selected, onSelect }: Props) {
  const meta = KIND_META[cell.kind];
  const Icon = meta.icon;

  // Визуальные стили под тип ячейки.
  // Источник — нейтральный. Auto/Formula — синий (поток). Manual — пунктир.
  // Final — зелёный (деньги).
  const styles = cn(
    "group relative w-full rounded-xl border bg-card text-left transition-all",
    "hover:border-foreground/30 hover:shadow-sm",
    selected
      ? "border-foreground ring-2 ring-foreground/15"
      : "border-border",
    cell.isFinal && "border-money/40 bg-money-muted hover:border-money",
    cell.kind === "manual" && "border-dashed",
    cell.kind === "formula" && !cell.isFinal && "bg-flow-muted border-flow/30",
    cell.kind === "auto" && "bg-flow-muted/50 border-flow/20"
  );

  const valueColor = cell.isFinal
    ? "text-money"
    : cell.kind === "formula" || cell.kind === "auto"
      ? "text-flow"
      : "text-foreground";

  return (
    <button type="button" onClick={() => onSelect?.(cell)} className={styles}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            cell.isFinal
              ? "text-money"
              : cell.kind === "formula" || cell.kind === "auto"
                ? "text-flow"
                : "text-muted-foreground"
          )}
        />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {meta.label}
        </span>
      </div>

      <div className="px-3 py-3">
        <div className="text-xs text-muted-foreground">{cell.label}</div>
        <div
          className={cn(
            "mt-1 font-semibold tabular-nums",
            cell.isFinal ? "text-2xl" : "text-lg",
            valueColor
          )}
        >
          {formatValue(cell)}
        </div>
        {cell.formula && (
          <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
            = {cell.formula}
          </div>
        )}
      </div>

      <div className="border-t border-border/60 px-3 py-1.5">
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {cell.address}
        </div>
        {cell.sheetRef && (
          <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-[9px] text-muted-foreground/70">
            <FileSpreadsheet className="h-2.5 w-2.5 shrink-0" />
            {cell.sheetRef}
          </div>
        )}
      </div>
    </button>
  );
}
