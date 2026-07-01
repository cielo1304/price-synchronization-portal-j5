"use client";

import { useEffect, useRef, useState } from "react";
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
  ExternalLink,
  X,
  Check,
  ArrowUpDown,
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

function formatValue(cell: Cell, overrideValue?: number | null): string {
  const v = overrideValue !== undefined ? overrideValue : cell.value;
  if (v === null) return "—";
  if (cell.unit === "%") return `${v} %`;
  if (cell.unit === "min") return `${v} мин`;
  return `${v.toLocaleString("ru-RU")} ₽`;
}

function formatRoValue(value: number | null, unit: Cell["unit"]): string {
  if (value === null) return "—";
  if (unit === "%") return `${value} %`;
  if (unit === "min") return `${value} мин`;
  return `${value.toLocaleString("ru-RU")} ₽`;
}

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
  /**
   * Если ячейка — наценка, родитель должен передать колбек, чтобы
   * пересчитать зависимые ячейки (part.retail_price, service.final_price).
   */
  onMarkupChange?: (newPct: number) => void;
};

export function CellCard({ cell, selected, onSelect, onMarkupChange }: Props) {
  const meta = KIND_META[cell.kind];
  const Icon = meta.icon;

  const {
    overrideCell,
    cellOverrides,
    clearOverride,
    loadServices,
    loadProducts,
    stockByKey,
    loadingStockKey,
    requestStock,
  } = useRemonline();
  const override = cellOverrides.get(cell.address);
  const hasOverride = override?.value !== undefined;
  // Правка пользователя (если ячейку редактировали). null = очищено, undefined = не трогали.
  const pendingValue = override?.value;
  const effectiveUrl = override?.url ?? cell.url;

  // Резолвим живое значение из РО. Для сравнения передаём то, что
  // «портал хочет отправить»: правку пользователя либо статику таблицы.
  const ro = useCellRoResolution(
    cell,
    hasOverride ? (pendingValue ?? null) : cell.value,
  );
  const roResolved = ro.state === "resolved";
  const roValue = roResolved ? ro.remoteValue : null;

  // Что показываем как основное значение ячейки:
  //  1) правка пользователя (если редактировал) →
  //  2) живое значение из РО (если snapshot загружен) →
  //  3) статичный слепок таблицы (fallback до загрузки РО).
  const effectiveValue = hasOverride
    ? (pendingValue ?? null)
    : roValue !== null
      ? roValue
      : cell.value;

  const [stockError, setStockError] = useState<string | null>(null);

  // ── Inline-редактирование (source-ячейки и наценка) ─────────────────
  const isEditable = cell.kind === "source" || cell.kind === "manual";
  const isMarkup = cell.kind === "manual" && cell.unit === "%";
  const [editing, setEditing] = useState(false);
  const [editPrice, setEditPrice] = useState<string>("");
  const [editUrl, setEditUrl] = useState<string>("");
  const priceRef = useRef<HTMLInputElement>(null);

  const openEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditPrice(effectiveValue !== null ? String(effectiveValue) : "");
    setEditUrl(effectiveUrl ?? "");
    setEditing(true);
  };

  const closeEdit = () => setEditing(false);

  const saveEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    const numVal = editPrice.trim() !== "" ? parseFloat(editPrice.replace(/\s/g, "").replace(",", ".")) : null;
    const finalVal = !isNaN(numVal ?? NaN) ? numVal : null;
    overrideCell(cell.address, {
      value: finalVal,
      url: editUrl.trim() || undefined,
    });
    if (isMarkup && finalVal !== null) {
      onMarkupChange?.(finalVal);
    }
    setEditing(false);
  };

  useEffect(() => {
    if (editing) {
      setTimeout(() => priceRef.current?.focus(), 0);
    }
  }, [editing]);

  // ── Синхронизация цены с РО ──────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);

  const isSyncableKind =
    cell.roMatch?.kind === "part-purchase" ||
    cell.roMatch?.kind === "part-retail" ||
    cell.roMatch?.kind === "service-price";

  // «Нужна синхронизация» — когда пользователь ввёл значение, отличное от
  // текущего в РО. Без правок ячейка показывает живое значение РО = синхронно.
  const needsSync =
    hasOverride &&
    pendingValue !== null &&
    pendingValue !== undefined &&
    isSyncableKind &&
    (roValue === null || pendingValue !== roValue);
  const isMismatch = needsSync;
  const canSync = needsSync;

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canSync || !cell.roMatch || pendingValue == null) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/remonline/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: cell.roMatch.kind,
          key: cell.roMatch.key,
          value: pendingValue,
          partProductId: cell.roMatch.partProductId ?? null,
          partCode: cell.roMatch.partCode ?? null,
          partArticle: cell.roMatch.partArticle ?? null,
          partBarcode: cell.roMatch.partBarcode ?? null,
          serviceBarcode: cell.roMatch.serviceBarcode ?? null,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSyncResult({ ok: true });
        // Правку убираем, а snapshot перечитываем — ячейка снова покажет
        // значение живьём из РО (теперь уже обновлённое).
        clearOverride(cell.address);
        if (cell.roMatch.kind === "service-price") {
          await loadServices();
        } else {
          await loadProducts();
        }
      } else {
        setSyncResult({ ok: false, error: json.error ?? "Ошибка" });
      }
    } catch (err) {
      setSyncResult({ ok: false, error: err instanceof Error ? err.message : "Ошибка" });
    } finally {
      setSyncing(false);
    }
  };

  // ── Остатки на складе ─────────────────────────────────────────────────
  const isPartCell =
    cell.roMatch?.kind === "part-retail" ||
    cell.roMatch?.kind === "part-purchase";
  const stockKey = isPartCell ? cell.roMatch!.key : null;
  const partArticle = isPartCell ? (cell.roMatch!.partArticle ?? null) : null;
  const partProductId = isPartCell ? (cell.roMatch!.partProductId ?? null) : null;
  const partCode = isPartCell ? (cell.roMatch!.partCode ?? null) : null;
  const partBarcode = isPartCell ? (cell.roMatch!.partBarcode ?? null) : null;
  const hasAnyPartId = !!(partArticle || partProductId || partCode || partBarcode);
  const liveStock = stockKey ? stockByKey.get(stockKey) : undefined;
  const stockLoading = stockKey !== null && loadingStockKey === stockKey;

  // Прямая ссылка на карточку в веб-интерфейсе РО.
  //  • услуги  → /company/services-pricelist/{id}
  //  • товары  → /warehouse/residue/{id}
  // Для услуг id берём из резолва прайса (ro.roId).
  // Для запчастей id может быть известен, даже если прайс не сматчился по
  // имени: берём его из карточки живого остатка (liveStock.product.id),
  // затем из partProductId привязки, и лишь потом из резолва прайса.
  const isServiceCell =
    cell.roMatch?.kind === "service-price" ||
    cell.roMatch?.kind === "service-duration";
  const serviceRoId = roResolved && isServiceCell ? ro.roId : null;
  const partRoId = isPartCell
    ? (liveStock?.product?.id ??
      (partProductId ? Number(partProductId) : null) ??
      (roResolved ? ro.roId : null))
    : null;
  const roDeepLink = isServiceCell
    ? serviceRoId != null
      ? `https://web.roapp.io/company/services-pricelist/${serviceRoId}`
      : null
    : isPartCell && partRoId != null
      ? `https://web.roapp.io/warehouse/residue/${partRoId}`
      : null;

  const handleRequestStock = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!stockKey) return;
    setStockError(null);
    if (!hasAnyPartId) {
      setStockError("У этой запчасти не заполнен ни один идентификатор.");
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
    selected ? "border-foreground ring-2 ring-foreground/15" : "border-border",
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
      {/* ── Шапка ── */}
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
          {roResolved && !needsSync && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-money-muted px-1.5 py-0.5 text-[9px] font-semibold text-money">
              <CheckCircle2 className="h-2.5 w-2.5" />
              РО
            </span>
          )}
        </div>

        {/* ── Значение ── */}
        {!editing && (
          <div className="px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">{cell.label}</div>
              {isEditable && (
                <button
                  type="button"
                  onClick={openEdit}
                  title="Редактировать"
                  className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition group-hover:opacity-100 hover:bg-muted"
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
            <div
              className={cn(
                "mt-1 font-semibold tabular-nums",
                cell.isFinal ? "text-2xl" : "text-lg",
                valueColor,
              )}
            >
              {formatValue(cell, effectiveValue)}
            </div>
            {effectiveUrl && (
              <a
                href={effectiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-1 flex items-center gap-1 truncate text-[10px] text-flow hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                {effectiveUrl.replace(/^https?:\/\//, "").slice(0, 40)}
              </a>
            )}
            {cell.formula && (
              <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                = {cell.formula}
              </div>
            )}
          </div>
        )}
      </button>

      {/* ── Inline-форма редактирования ── */}
      {editing && (
        <div className="px-3 py-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs font-medium text-foreground">{cell.label}</div>
          <div className="space-y-1.5">
            <label className="text-[10px] text-muted-foreground">
              {isMarkup ? "Наценка %" : "Цена, ₽"}
            </label>
            <input
              ref={priceRef}
              type="number"
              value={editPrice}
              onChange={(e) => setEditPrice(e.target.value)}
              placeholder={isMarkup ? "0" : "0"}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm tabular-nums outline-none focus:border-foreground/50 focus:ring-1 focus:ring-foreground/20"
            />
          </div>
          {cell.kind === "source" && (
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">Ссылка на источник</label>
              <input
                type="url"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] outline-none focus:border-foreground/50 focus:ring-1 focus:ring-foreground/20"
              />
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-medium text-background transition hover:opacity-90"
            >
              <Check className="h-3 w-3" />
              Сохранить
            </button>
            <button
              type="button"
              onClick={closeEdit}
              className="flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-foreground/40"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── Предупреждение ── */}
      {cell.warning && (
        <div className="flex items-start gap-2 border-t border-amber-500/30 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="text-pretty text-left">{cell.warning}</span>
        </div>
      )}

      {/* ── Эхо из Remonline: сравнение цен ── */}
      {ro.state === "resolved" && (
        <div
          className={cn(
            "border-t px-3 py-2",
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
                "font-mono tabular-nums text-[11px]",
                isMismatch ? "font-semibold text-rose-700" : "text-money",
              )}
            >
              {formatRoValue(ro.remoteValue, cell.unit)}
            </span>
          </div>

          {isMismatch && (
            <>
              <div className="mt-1 flex items-center gap-2 rounded-md bg-rose-100 px-2 py-1.5">
                <ArrowUpDown className="h-3 w-3 shrink-0 text-rose-600" />
                <span className="text-[10px] leading-snug text-rose-800">
                  Ваше значение:{" "}
                  <span className="font-semibold tabular-nums">
                    {formatRoValue(pendingValue ?? null, cell.unit)}
                  </span>
                  {" "}сейчас в РО:{" "}
                  <span className="font-semibold tabular-nums">
                    {formatRoValue(ro.remoteValue, cell.unit)}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing || !canSync}
                className={cn(
                  "mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition",
                  canSync
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "cursor-not-allowed bg-muted text-muted-foreground",
                )}
              >
                {syncing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {syncing ? "Синхронизация…" : "Синхронизировать с РО"}
              </button>
              {syncResult && (
                <div
                  className={cn(
                    "mt-1.5 rounded-md px-2 py-1 text-[10px] font-medium",
                    syncResult.ok
                      ? "bg-money-muted text-money"
                      : "bg-rose-100 text-rose-700",
                  )}
                >
                  {syncResult.ok
                    ? "Цена обновлена в Remonline"
                    : `Ошибка: ${syncResult.error}`}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Live-остатки ── */}
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
              {stockLoading ? "Запрос…" : liveStock ? "Обновить" : "Запросить"}
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
                {liveStock.found ? `${liveStock.quantity} шт` : "Не найдено в РО"}
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

          {/* Диагностика: исходник → РО */}
          <div className="mt-2 space-y-1 rounded-md border border-border/60 bg-background/60 p-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              исходник → РО
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
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
                const roValue = liveStock?.product
                  ? (liveStock.product[kind as keyof typeof liveStock.product] ?? null)
                  : null;
                return (
                  <div
                    key={label}
                    className={cn(
                      "flex items-start justify-between gap-1",
                      isWinner && "rounded bg-money-muted px-1 py-0.5 text-money",
                    )}
                  >
                    <span className="shrink-0 text-muted-foreground">{label}:</span>
                    <div className="flex flex-1 flex-col items-end gap-0.5 text-right">
                      <span className={cn("tabular-nums", !value && "text-muted-foreground/50")}>
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
                      {roValue ? (
                        <span
                          className={cn(
                            "text-[9px]",
                            roValue === value ? "text-muted-foreground/40" : "text-muted-foreground/60",
                          )}
                        >
                          РО: {roValue}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {liveStock?.matchedBy && (
              <div className="text-[9px] text-money">
                найдено по {liveStock.matchedBy.kind}: «{liveStock.matchedBy.value}»
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

      {roDeepLink && (
        <div className="border-t border-border/60 px-3 py-2">
          <a
            href={roDeepLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-money/30 bg-card px-3 py-1.5 text-[11px] font-medium text-money transition hover:bg-money-muted"
          >
            <ExternalLink className="h-3 w-3" />
            Открыть в РО
          </a>
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
