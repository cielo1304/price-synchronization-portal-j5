"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Cell } from "@/lib/portal-types";
import {
  Database,
  Sigma,
  Pencil,
  Cpu,
  ArrowDownToLine,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Send,
  Package,
} from "lucide-react";
import { useCellRoResolution, useRemonline } from "@/lib/remonline/context";

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

function formatRoValue(value: number | null, unit: Cell["unit"]): string {
  if (value === null) return "—";
  if (unit === "%") return `${value} %`;
  if (unit === "min") return `${value} мин`;
  return `${value.toLocaleString("ru-RU")} ₽`;
}

type Props = {
  cell: Cell;
  selected?: boolean;
  onSelect?: (cell: Cell) => void;
};

export function CellCard({ cell, selected, onSelect }: Props) {
  const meta = KIND_META[cell.kind];
  const Icon = meta.icon;

  const ro = useCellRoResolution(cell, cell.value);
  const { syncCell } = useRemonline();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const isMismatch = ro.state === "resolved" && !ro.inSync;

  const styles = cn(
    "group relative w-full rounded-xl border bg-card text-left transition-all",
    "hover:border-foreground/30 hover:shadow-sm",
    selected
      ? "border-foreground ring-2 ring-foreground/15"
      : "border-border",
    cell.isFinal && "border-money/40 bg-money-muted hover:border-money",
    cell.kind === "manual" && "border-dashed",
    cell.kind === "formula" && !cell.isFinal && "bg-flow-muted border-flow/30",
    cell.kind === "auto" && "bg-flow-muted/50 border-flow/20",
    isMismatch && "border-rose-400 ring-2 ring-rose-200",
  );

  const valueColor = cell.isFinal
    ? "text-money"
    : cell.kind === "formula" || cell.kind === "auto"
      ? "text-flow"
      : "text-foreground";

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cell.value === null) return;
    setSyncing(true);
    setSyncError(null);
    const res = await syncCell(cell, cell.value);
    setSyncing(false);
    if (!res.ok) setSyncError(res.error ?? "Ошибка");
  };

  return (
    <div className={styles}>
      <button
        type="button"
        onClick={() => onSelect?.(cell)}
        className="w-full text-left"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              cell.isFinal
                ? "text-money"
                : cell.kind === "formula" || cell.kind === "auto"
                  ? "text-flow"
                  : "text-muted-foreground",
            )}
          />
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {meta.label}
          </span>
          {isMismatch && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold text-rose-700">
              <CircleAlert className="h-2.5 w-2.5" />
              РО
            </span>
          )}
          {ro.state === "resolved" && ro.inSync && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-money-muted px-1.5 py-0.5 text-[9px] font-semibold text-money">
              <CheckCircle2 className="h-2.5 w-2.5" />
              РО
            </span>
          )}
        </div>

        <div className="px-3 py-3">
          <div className="text-xs text-muted-foreground">{cell.label}</div>
          <div
            className={cn(
              "mt-1 font-semibold tabular-nums",
              cell.isFinal ? "text-2xl" : "text-lg",
              valueColor,
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
      </button>

      {cell.warning && (
        <div className="flex items-start gap-2 border-t border-amber-500/30 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="text-pretty text-left">{cell.warning}</span>
        </div>
      )}

      {/* Эхо из Remonline — если ячейка имеет roMatch */}
      {ro.state === "resolved" && (
        <div
          className={cn(
            "border-t px-3 py-2 text-[11px] leading-snug",
            isMismatch
              ? "border-rose-200 bg-rose-50"
              : "border-money/20 bg-money-muted/40",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-[9px] font-semibold uppercase tracking-wider",
                isMismatch ? "text-rose-700" : "text-money",
              )}
            >
              в Remonline
            </span>
            <span
              className={cn(
                "font-mono tabular-nums",
                isMismatch
                  ? "font-semibold text-rose-700"
                  : "text-money",
              )}
            >
              {formatRoValue(ro.remoteValue, cell.unit)}
            </span>
          </div>
          {typeof ro.remoteResidue === "number" && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Package className="h-2.5 w-2.5" />
              на складе: {ro.remoteResidue} шт
            </div>
          )}
          {isMismatch && cell.value !== null && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2 text-[10px] font-semibold uppercase tracking-wider text-background transition hover:bg-foreground/85 disabled:opacity-50"
              >
                {syncing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                {syncing ? "Пишу…" : "Записать в РО"}
              </button>
              {syncError && (
                <span className="text-[10px] text-rose-700">{syncError}</span>
              )}
            </div>
          )}
        </div>
      )}

      {ro.state === "key-not-found" && (
        <div className="border-t border-amber-200 bg-amber-50/60 px-3 py-2 text-[10px] leading-snug text-amber-900">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>Нет в РО — заведите вручную</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[9px] text-amber-700/70">
            ключ: {ro.expectedKey.slice(0, 50)}…
          </div>
        </div>
      )}

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
    </div>
  );
}
