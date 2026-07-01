"use client";

import { useState } from "react";
import { Plus, X, Check, ExternalLink } from "lucide-react";
import type { Cell, Stage } from "@/lib/portal-types";
import { CellCard } from "./cell-card";
import { cn } from "@/lib/utils";
import { useRemonline } from "@/lib/remonline/context";

type Props = {
  stage: Stage;
  index: number;
  selectedAddress: string | null;
  onSelectCell: (cell: Cell) => void;
  /**
   * Когда изменяется наценка в этой стадии, родитель (cell-inspector или
   * portal-shell) должен пересчитать retail_price и final_price.
   * Передавать только в стадии "markup".
   */
  onMarkupChange?: (newPct: number) => void;
  /**
   * Карта пересчитанных «живых» значений (адрес → значение) для формульных
   * ячеек. Приходит из portal-shell.
   */
  liveValues?: Map<string, number | null>;
};

export function PipelineStage({
  stage,
  index,
  selectedAddress,
  onSelectCell,
  onMarkupChange,
  liveValues,
}: Props) {
  const isPlaceholder = stage.placeholder;
  const { addSource, addedSources, overrideCell } = useRemonline();

  // Форма добавления нового источника
  const [addingSource, setAddingSource] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const stageAddress = `${stage.id}`;

  const openAddSource = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNewLabel("");
    setNewUrl("");
    setNewPrice("");
    setAddingSource(true);
  };

  const cancelAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAddingSource(false);
  };

  const saveAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!newLabel.trim()) return;
    const numVal =
      newPrice.trim() !== ""
        ? parseFloat(newPrice.replace(/\s/g, "").replace(",", "."))
        : null;
    const finalVal = !isNaN(numVal ?? NaN) ? numVal : null;
    addSource(stageAddress, {
      label: newLabel.trim(),
      url: newUrl.trim(),
      value: finalVal,
    });
    setAddingSource(false);
  };

  // Дополнительные источники из памяти сессии
  const extraSources = addedSources.get(stageAddress) ?? [];

  return (
    <div
      className={cn(
        "flex w-64 shrink-0 flex-col gap-3 transition-opacity",
        isPlaceholder && "opacity-50",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 className="text-sm font-semibold text-foreground">{stage.title}</h3>
      </div>
      {stage.subtitle && (
        <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
          {stage.subtitle}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {stage.cells.map((cell) => (
          <CellCard
            key={cell.address}
            cell={cell}
            selected={selectedAddress === cell.address}
            onSelect={onSelectCell}
            onMarkupChange={onMarkupChange}
            computedValue={liveValues?.get(cell.address)}
          />
        ))}

        {/* Дополнительные источники, добавленные в сессии */}
        {extraSources.map((src, i) => {
          const addr = `${stageAddress}.extra.${i}`;
          const fakeCell: Cell = {
            address: addr,
            label: src.label,
            kind: "source",
            value: src.value,
            unit: "₽",
            url: src.url || undefined,
            source: src.url ? `поставщик: ${src.url}` : "добавлено вручную",
          };
          return (
            <CellCard
              key={addr}
              cell={fakeCell}
              selected={selectedAddress === addr}
              onSelect={onSelectCell}
            />
          );
        })}

        {/* Форма добавления источника */}
        {addingSource && stage.canAdd && !isPlaceholder && (
          <div
            className="rounded-xl border border-dashed border-flow bg-flow-muted/30 p-3 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-flow">
              Новый источник
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">
                Название поставщика *
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Например: iExpert"
                autoFocus
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/50 focus:ring-1 focus:ring-foreground/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">
                Ссылка на товар
              </label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] outline-none focus:border-foreground/50 focus:ring-1 focus:ring-foreground/20"
              />
              {newUrl && (
                <a
                  href={newUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-flow hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Открыть ссылку
                </a>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">
                Цена, ₽
              </label>
              <input
                type="number"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="0"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm tabular-nums outline-none focus:border-foreground/50 focus:ring-1 focus:ring-foreground/20"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveAdd}
                disabled={!newLabel.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-medium text-background transition hover:opacity-90 disabled:opacity-40"
              >
                <Check className="h-3 w-3" />
                Добавить
              </button>
              <button
                type="button"
                onClick={cancelAdd}
                className="flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-foreground/40"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {stage.canAdd && !isPlaceholder && !addingSource && (
          <button
            type="button"
            onClick={openAddSource}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-3 py-3 text-xs text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить источник
          </button>
        )}
      </div>
    </div>
  );
}
