"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Cell, Position } from "@/lib/portal-types";
import { PositionHeader } from "./position-header";
import { Legend } from "./legend";
import { PipelineStage } from "./pipeline-stage";
import { OutputTargets } from "./output-targets";
import { CellInspector } from "./cell-inspector";

type Props = {
  position: Position;
};

export function PortalShell({ position }: Props) {
  // По умолчанию выбрана конечная цена — это самое интересное.
  const allCells = useMemo(
    () => position.stages.flatMap((s) => s.cells),
    [position]
  );
  const defaultAddress =
    allCells.find((c) => c.isFinal)?.address ?? allCells[0]?.address ?? null;

  const [selectedAddress, setSelectedAddress] = useState<string | null>(
    defaultAddress
  );

  const selectedCell: Cell | null = useMemo(() => {
    if (!selectedAddress) return null;
    return allCells.find((c) => c.address === selectedAddress) ?? null;
  }, [selectedAddress, allCells]);

  const handleSelectCell = (cell: Cell) => setSelectedAddress(cell.address);
  const handleSelectAddress = (addr: string) => setSelectedAddress(addr);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-foreground" />
          <div className="text-sm font-semibold tracking-tight text-foreground">
            Maxmobiles · Прайс-портал
          </div>
        </div>
        <div className="hidden text-xs text-muted-foreground md:block">
          Прототип на одной позиции
        </div>
      </header>

      <PositionHeader position={position} />
      <Legend />

      <div className="flex gap-6">
        <main className="min-w-0 flex-1">
          <section className="rounded-2xl border border-border bg-card/40 p-5">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Конвейер цены
                </h3>
                <p className="text-xs text-muted-foreground">
                  Слева направо: данные текут от поставщиков к итоговой цене услуги
                </p>
              </div>
            </div>

            <div className="-mx-5 overflow-x-auto px-5 pb-2">
              <div className="flex min-w-max items-start gap-3">
                {position.stages.map((stage, i) => (
                  <div key={stage.id} className="flex items-stretch gap-3">
                    <PipelineStage
                      stage={stage}
                      index={i}
                      selectedAddress={selectedAddress}
                      onSelectCell={handleSelectCell}
                    />
                    {i < position.stages.length - 1 && (
                      <div className="flex shrink-0 items-center pt-12">
                        <ChevronRight className="h-5 w-5 text-muted-foreground/60" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-border bg-card/40 p-5">
            <OutputTargets
              outputs={position.outputs}
              onSelectAddress={handleSelectAddress}
            />
          </section>
        </main>

        <CellInspector
          cell={selectedCell}
          onSelectAddress={handleSelectAddress}
        />
      </div>
    </div>
  );
}
