"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Menu, X } from "lucide-react";
import type { Cell, Position } from "@/lib/portal-types";
import { compute, getQuickFinal } from "@/lib/portal-catalog";
import { PositionHeader } from "./position-header";
import { Legend } from "./legend";
import { PipelineStage } from "./pipeline-stage";
import { OutputTargets } from "./output-targets";
import { CellInspector } from "./cell-inspector";
import { CatalogNav } from "./catalog-nav";
import { VariantSwitcher } from "./variant-switcher";
import { cn } from "@/lib/utils";

type Props = {
  catalog: Position[];
  defaultPositionId?: string;
};

export function PortalShell({ catalog, defaultPositionId }: Props) {
  const [selectedPositionId, setSelectedPositionId] = useState<string>(
    defaultPositionId ?? catalog[0]?.id ?? "",
  );
  const [variantByPosition, setVariantByPosition] = useState<
    Record<string, string>
  >({});
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const position = useMemo(
    () => catalog.find((p) => p.id === selectedPositionId) ?? catalog[0],
    [catalog, selectedPositionId],
  );

  const selectedVariantId = variantByPosition[position.id];
  const composed = useMemo(
    () => compute(position, selectedVariantId),
    [position, selectedVariantId],
  );

  const allCells = useMemo(
    () => composed.stages.flatMap((s) => s.cells),
    [composed],
  );

  const defaultAddress =
    allCells.find((c) => c.isFinal)?.address ?? allCells[0]?.address ?? null;

  const [selectedAddress, setSelectedAddress] = useState<string | null>(
    defaultAddress,
  );

  const handleSelectPosition = (id: string) => {
    setSelectedPositionId(id);
    const next = catalog.find((p) => p.id === id);
    if (!next) return;
    const c = compute(next, variantByPosition[id]);
    const finalAddr = c.stages.flatMap((s) => s.cells).find((x) => x.isFinal)?.address;
    setSelectedAddress(finalAddr ?? null);
    setMobileNavOpen(false);
  };

  const handleVariantChange = (variantId: string) => {
    setVariantByPosition((prev) => ({ ...prev, [position.id]: variantId }));
    // Сохраняем фокус на финале
    const c = compute(position, variantId);
    const finalAddr = c.stages.flatMap((s) => s.cells).find((x) => x.isFinal)?.address;
    setSelectedAddress(finalAddr ?? null);
  };

  const selectedCell: Cell | null = useMemo(() => {
    if (!selectedAddress) return null;
    return allCells.find((c) => c.address === selectedAddress) ?? null;
  }, [selectedAddress, allCells]);

  const handleSelectCell = (cell: Cell) => setSelectedAddress(cell.address);
  const handleSelectAddress = (addr: string) => setSelectedAddress(addr);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border lg:hidden"
            aria-label="Каталог услуг"
          >
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-foreground" />
            <div className="text-sm font-semibold tracking-tight text-foreground">
              Maxmobiles · Прайс-портал
            </div>
          </div>
        </div>
        <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
          <span>{catalog.length} позиций · iPhone 16</span>
          <span className="rounded-full border border-border bg-card px-2 py-0.5 font-mono">
            данные из вашей таблицы
          </span>
        </div>
      </header>

      <div className="flex gap-6">
        <CatalogNav
          positions={catalog}
          selectedId={selectedPositionId}
          onSelect={handleSelectPosition}
        />

        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          >
            <div
              className="absolute left-0 top-0 h-full w-72 max-w-[85%] border-r border-border bg-background p-3 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <MobileCatalog
                positions={catalog}
                selectedId={selectedPositionId}
                onSelect={handleSelectPosition}
              />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <PositionHeader position={position} finalPrice={composed.finalPrice} />

          {position.variants && position.variants.length > 0 && (
            <VariantSwitcher
              variants={position.variants}
              selectedId={composed.selectedVariant?.id ?? null}
              onSelect={handleVariantChange}
            />
          )}

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
                    {composed.stages.map((stage, i) => (
                      <div key={stage.id} className="flex items-stretch gap-3">
                        <PipelineStage
                          stage={stage}
                          index={i}
                          selectedAddress={selectedAddress}
                          onSelectCell={handleSelectCell}
                        />
                        {i < composed.stages.length - 1 && (
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
                  outputs={composed.outputs}
                  onSelectAddress={handleSelectAddress}
                />
              </section>
            </main>

            <CellInspector cell={selectedCell} onSelectAddress={handleSelectAddress} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileCatalog({
  positions,
  selectedId,
  onSelect,
}: {
  positions: Position[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={cn("flex flex-col gap-3")}>
      <div className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Каталог услуг
      </div>
      <ul className="flex max-h-[80vh] flex-col gap-1 overflow-y-auto">
        {positions.map((p) => {
          const final = getQuickFinal(p);
          const isActive = p.id === selectedId;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition",
                  isActive
                    ? "bg-foreground text-background"
                    : "text-foreground/90 hover:bg-muted/60",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] leading-tight">
                    {p.category}
                  </span>
                  <span
                    className={cn(
                      "block truncate text-[11px] leading-tight",
                      isActive ? "text-background/70" : "text-muted-foreground",
                    )}
                  >
                    {p.variant}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono text-[11px] tabular-nums",
                    isActive ? "text-background" : "text-money",
                  )}
                >
                  {final !== null ? `${final.toLocaleString("ru-RU")} ₽` : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
