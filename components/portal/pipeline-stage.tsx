"use client";

import { Plus } from "lucide-react";
import type { Cell, Stage } from "@/lib/portal-types";
import { CellCard } from "./cell-card";

type Props = {
  stage: Stage;
  index: number;
  selectedAddress: string | null;
  onSelectCell: (cell: Cell) => void;
};

export function PipelineStage({
  stage,
  index,
  selectedAddress,
  onSelectCell,
}: Props) {
  return (
    <div className="flex w-64 shrink-0 flex-col gap-3">
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
          />
        ))}

        {stage.canAdd && (
          <button
            type="button"
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
