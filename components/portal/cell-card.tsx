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
  Package,
  RefreshCw,
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

/** «5 сек назад», «2 мин назад» — подпись под live-остатком */
function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "только что";
  if (sec < 60) return `${sec} сек назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  return `${h} ч назад`;
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
  const { stockByKey, loadingStockKey, requestStock } = useRemonline();
  const [stockError, setStockError] = useState<string | null>(null);

  const isMismatch = ro.state === "resolved" && !ro.inSync;

  // Кнопка «Запросить остатки» появляется только для ячеек запчасти.
  // У запчасти в исходной таблице может быть до 4 идентификаторов:
  // ID, Код, Артикул, Штрихкод. Сервер сам выбирает, какой из них
  // отдать в `?search=` РО — мы отправляем все непустые.
  const isPartCell =
    cell.roMatch?.kind === "part-retail" ||
    cell.roMatch?.kind === "part-purchase";
  const stockKey = isPartCell ? cell.roMatch!.key : null;
  const partArticle = isPartCell ? (cell.roMatch!.partArticle ?? null) : null;
  const partProductId = isPartCell
    ? (cell.roMatch!.partProductId ?? null)
    : null;
  const partCode = isPartCell ? (cell.roMatch!.partCode ?? null) : null;
  const partBarcode = isPartCell ? (cell.roMatch!.partBarcode ?? null) : null;
  const hasAnyPartId = !!(
    partArticle ||
    partProductId ||
    partCode ||
    partBarcode
  );
  const liveStock = stockKey ? stockByKey.get(stockKey) : undefined;
  const stockLoading = stockKey !== null && loadingStockKey === stockKey;

  const handleRequestStock = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!stockKey) return;
    setStockError(null);
    if (!hasAnyPartId) {
      setStockError(
        "У этой запчасти не заполнен ни один идентификатор (ID, Код, Артикул, Штрихкод).",
      );
      return;
    }
    const res = await requestStock(stockKey, {
      partArticle,
      partProductId,
      partCode,
      partBarcode,
    });
    if (!res.ok) setStockError(res.error ?? "Ошибка");
  };

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
          {isMismatch && (
            <div className="mt-1 text-[10px] text-rose-700/80">
              Цены в портале и в РО расходятся — выровняйте вручную в Remonline.
            </div>
          )}
        </div>
      )}

      {/* Live-остатки запчасти: запрашиваются по кноп��е прямо в ячейке */}
      {isPartCell && (
        <div className="border-t border-border/60 bg-card/40 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Package className="h-3 w-3" />
              остаток на складе
            </div>
            <button
              type="button"
              onClick={handleRequestStock}
              disabled={stockLoading}
              className="flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[10px] font-medium text-foreground transition hover:border-foreground/40 disabled:opacity-50"
            >
              {stockLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {stockLoading
                ? "Запрос…"
                : liveStock
                  ? "Обновить"
                  : "Запросить"}
            </button>
          </div>
          {liveStock && (
            <div className="mt-1.5 flex items-baseline justify-between">
              <span
                className={cn(
                  "text-base font-semibold tabular-nums",
                  liveStock.found
                    ? liveStock.quantity > 0
                      ? "text-money"
                      : "text-rose-700"
                    : "text-muted-foreground",
                )}
              >
                {liveStock.found
                  ? `${liveStock.quantity} шт`
                  : "Не найдено в РО"}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {formatAgo(liveStock.fetchedAt)}
              </span>
            </div>
          )}
          {liveStock?.perWarehouse &&
            liveStock.perWarehouse.filter((w) => w.quantity > 0).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {liveStock.perWarehouse
                  .filter((w) => w.quantity > 0)
                  .map((w) => (
                    <span
                      key={w.warehouseId}
                      className="rounded bg-money-muted px-1.5 py-0.5 text-[10px] font-medium text-money"
                    >
                      {w.warehouseTitle}: {w.quantity}
                    </span>
                  ))}
              </div>
            )}
          {stockError && (
            <div className="mt-1 text-[10px] text-rose-700">{stockError}</div>
          )}
          {!liveStock && !stockLoading && !stockError && (
            <div className="mt-1 text-[10px] text-muted-foreground">
              Нажмите «Запросить», чтобы получить актуальный остаток.
            </div>
          )}

          {/* Диагностика: что у нас в исходнике и что сработало в РО.
              Показываем всегда — чтобы было сразу видно, какие колонки
              реально заполнены в портале и почему `?search=` нашёл
              именно этот товар. */}
          <div className="mt-2 space-y-1 rounded-md border border-border/60 bg-background/60 p-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              исходник → РО
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px]">
              {(
                [
                  ["ID", partProductId, "productId"],
                  ["Код", partCode, "code"],
                  ["Артикул", partArticle, "article"],
                  ["Штрихкод", partBarcode, "barcode"],
                ] as const
              ).map(([label, value, kind]) => {
                const tried = liveStock?.tried?.find((t) => t.kind === kind);
                const isWinner = liveStock?.matchedBy?.kind === kind;
                return (
                  <div
                    key={label}
                    className={cn(
                      "flex items-center justify-between gap-1",
                      isWinner && "rounded bg-money-muted px-1 text-money",
                    )}
                  >
                    <span className="text-muted-foreground">{label}:</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        !value && "text-muted-foreground/50",
                      )}
                    >
                      {value ?? "—"}
                      {tried && (
                        <span
                          className={cn(
                            "ml-1 text-[9px]",
                            tried.hits > 0 ? "text-money" : "text-rose-600",
                          )}
                        >
                          [{tried.hits}]
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {liveStock?.matchedBy && (
              <div className="text-[9px] text-money">
                ✓ найдено по {liveStock.matchedBy.kind}: «
                {liveStock.matchedBy.value}»
              </div>
            )}
            {liveStock?.product && (
              <div className="truncate text-[9px] text-muted-foreground">
                РО: {liveStock.product.title}
              </div>
            )}
          </div>
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
