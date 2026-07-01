"use client";

import type { Cell } from "@/lib/portal-types";
import { cn } from "@/lib/utils";
import { ArrowRight, Copy, Link2, FileSpreadsheet } from "lucide-react";
import {
  useCellRoResolution,
  useLiveValueMap,
  useRemonline,
} from "@/lib/remonline/context";

type Props = {
  cell: Cell | null;
  onSelectAddress: (address: string) => void;
  /** Все ячейки позиции — нужны для пересчёта формульных значений. */
  allCells?: Cell[];
};

const KIND_RU: Record<Cell["kind"], string> = {
  source: "Источник данных",
  auto: "Авто-выбор",
  manual: "Ручной ввод",
  formula: "Формула",
  output: "Выгрузка",
};

function formatValue(value: number | null, unit: Cell["unit"]): string {
  if (value === null) return "—";
  if (unit === "%") return `${value} %`;
  if (unit === "min") return `${value} мин`;
  return `${value.toLocaleString("ru-RU")} ₽`;
}

export function CellInspector({ cell, onSelectAddress, allCells }: Props) {
  if (!cell) {
    return (
      <aside className="sticky top-6 hidden h-fit w-[320px] shrink-0 rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center xl:block">
        <div className="text-sm font-medium text-foreground">
          Инспектор ячейки
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Кликните на любую ячейку слева, чтобы увидеть её адрес, формулу и связи
        </p>
      </aside>
    );
  }

  return (
    <CellInspectorBody
      cell={cell}
      onSelectAddress={onSelectAddress}
      allCells={allCells ?? []}
    />
  );
}

function CellInspectorBody({
  cell,
  onSelectAddress,
  allCells,
}: {
  cell: Cell;
  onSelectAddress: (address: string) => void;
  allCells: Cell[];
}) {
  // То же живое значение, что и в ячейке конвейера:
  // правка пользователя → живое из РО → пересчёт формулы → статичный слепок.
  const { cellOverrides } = useRemonline();
  const liveValues = useLiveValueMap(allCells);
  const override = cellOverrides.get(cell.address);
  const hasOverride = override?.value !== undefined;
  const ro = useCellRoResolution(
    cell,
    hasOverride ? (override?.value ?? null) : cell.value,
  );
  const roValue = ro.state === "resolved" ? ro.remoteValue : null;
  const computed = liveValues.get(cell.address);
  const effectiveValue = hasOverride
    ? (override?.value ?? null)
    : roValue !== null
      ? roValue
      : computed !== undefined && computed !== null
        ? computed
        : cell.value;

  return (
    <aside className="sticky top-6 hidden h-fit w-[320px] shrink-0 rounded-2xl border border-border bg-card p-5 xl:block">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            cell.isFinal
              ? "bg-money text-money-foreground"
              : cell.kind === "manual"
                ? "border border-dashed border-foreground/40 text-foreground"
                : cell.kind === "formula" || cell.kind === "auto"
                  ? "bg-flow text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
          )}
        >
          {KIND_RU[cell.kind]}
        </span>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">{cell.label}</div>
      <div
        className={cn(
          "text-3xl font-semibold tabular-nums",
          cell.isFinal
            ? "text-money"
            : cell.kind === "formula" || cell.kind === "auto"
              ? "text-flow"
              : "text-foreground"
        )}
      >
        {formatValue(effectiveValue, cell.unit)}
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Link2 className="h-3 w-3" /> Адрес
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-2.5 py-2">
            <code className="flex-1 truncate font-mono text-[11px] text-foreground">
              {cell.address}
            </code>
            <button
              type="button"
              className="text-muted-foreground transition hover:text-foreground"
              onClick={() => navigator.clipboard?.writeText(cell.address)}
              aria-label="Скопировать адрес"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Это API-путь к ячейке. По нему её можно прочитать или изменить из любой системы.
          </p>
        </div>

        {cell.formula && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Формула
            </div>
            <code className="block rounded-lg border border-border bg-secondary px-2.5 py-2 font-mono text-[11px] text-foreground">
              {cell.formula}
            </code>
          </div>
        )}

        {cell.dependsOn && cell.dependsOn.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Зависит от
            </div>
            <div className="flex flex-col gap-1">
              {cell.dependsOn.map((addr) => (
                <button
                  key={addr}
                  type="button"
                  onClick={() => onSelectAddress(addr)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[10px] text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span className="truncate">{addr}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {cell.sheetRef && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <FileSpreadsheet className="h-3 w-3" /> Где в Google Sheets
            </div>
            <div className="rounded-lg border border-border bg-secondary px-2.5 py-2">
              <code className="font-mono text-[11px] text-foreground">
                {cell.sheetRef}
              </code>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              При импорте этой ячейки портал заберёт значение отсюда и привяжет к API-адресу выше.
            </p>
          </div>
        )}

        {cell.source && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Источник
            </div>
            <div className="text-xs text-foreground">{cell.source}</div>
          </div>
        )}

        {cell.note && (
          <div className="rounded-lg border border-border bg-secondary/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            {cell.note}
          </div>
        )}
      </div>
    </aside>
  );
}
