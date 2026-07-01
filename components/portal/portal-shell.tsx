"use client";

import { useMemo, useState } from "react";
import { ChevronRight, LogOut, Menu, X } from "lucide-react";
import type { Cell, Position, PositionStub } from "@/lib/portal-types";
import {
  getPositionById,
  getCustomPosition,
  customStubsFromModels,
} from "@/lib/portal-catalog";
import { useOverride } from "@/lib/portal-overrides";
import { useCustomModels } from "@/lib/portal-custom-models";
import { RemonlineProvider, useLiveValueMap } from "@/lib/remonline/context";
import { SyncPanel } from "./sync-panel";
import { PositionHeader } from "./position-header";
import { Legend } from "./legend";
import { PipelineStage } from "./pipeline-stage";
import { OutputTargets } from "./output-targets";
import { CellInspector } from "./cell-inspector";
import { CatalogNav } from "./catalog-nav";
import { cn } from "@/lib/utils";

type Props = {
  index: PositionStub[];
  defaultPositionId?: string;
};

export function PortalShell({ index, defaultPositionId }: Props) {
  const [selectedPositionId, setSelectedPositionId] = useState<string>(
    defaultPositionId ?? index[0]?.id ?? "",
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Пользовательские модели (новый iPhone 18 и т.п.) — реактивно из localStorage.
  const customModels = useCustomModels();

  // Полный каталог = базовый + пользовательские модели.
  const fullIndex = useMemo(() => {
    const customStubs = customStubsFromModels(customModels);
    return customStubs.length > 0 ? [...customStubs, ...index] : index;
  }, [index, customModels]);

  // Полная позиция строится лениво только для активного id.
  const basePosition = useMemo(() => {
    if (selectedPositionId.startsWith("custom.")) {
      return (
        getCustomPosition(customModels, selectedPositionId) ??
        getPositionById(index[0]?.id ?? "")
      );
    }
    return (
      getPositionById(selectedPositionId) ??
      (index[0] ? getPositionById(index[0].id) : null)
    );
  }, [selectedPositionId, index, customModels]);

  // Поверх данных портала накладываются ручные правки пользователя.
  const override = useOverride(basePosition?.id ?? "");
  const position: Position | null = useMemo(() => {
    if (!basePosition) return null;
    if (!override) return basePosition;
    return {
      ...basePosition,
      warranty: override.warranty ?? basePosition.warranty,
      laborMinutes: override.laborMinutes ?? basePosition.laborMinutes,
    };
  }, [basePosition, override]);

  const allCells = useMemo(
    () => (position ? position.stages.flatMap((s) => s.cells) : []),
    [position],
  );

  const finalAddress = useMemo(
    () => allCells.find((c) => c.isFinal)?.address ?? null,
    [allCells],
  );

  const [selectedAddress, setSelectedAddress] = useState<string | null>(
    finalAddress,
  );

  const handleSelectPosition = (id: string) => {
    setSelectedPositionId(id);
    const next = id.startsWith("custom.")
      ? getCustomPosition(customModels, id)
      : getPositionById(id);
    const fa =
      next?.stages.flatMap((s) => s.cells).find((c) => c.isFinal)?.address ??
      null;
    setSelectedAddress(fa);
    setMobileNavOpen(false);
  };

  const selectedCell: Cell | null = useMemo(() => {
    if (!selectedAddress) return null;
    return allCells.find((c) => c.address === selectedAddress) ?? null;
  }, [selectedAddress, allCells]);

  const handleSelectCell = (cell: Cell) => setSelectedAddress(cell.address);
  const handleSelectAddress = (addr: string) => setSelectedAddress(addr);

  if (!position) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Каталог пуст. Сначала запустите{" "}
        <code className="font-mono">scripts/extract-all.js</code>.
      </div>
    );
  }

  return (
    <RemonlineProvider>
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border lg:hidden"
            aria-label="Каталог услуг"
          >
            {mobileNavOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </button>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-foreground" />
            <div className="text-sm font-semibold tracking-tight text-foreground">
              Maxmobiles · Прайс-портал
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden md:inline">
            {fullIndex.length.toLocaleString("ru-RU")} позиций
          </span>
          <span className="hidden rounded-full border border-border bg-card px-2 py-0.5 font-mono md:inline">
            данные из вашей таблицы
          </span>
          <SyncPanel />
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="Выйти"
            title="Выйти"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Выйти</span>
          </button>
        </div>
      </header>

      <div className="flex gap-6">
        <CatalogNav
          positions={fullIndex}
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
                positions={fullIndex}
                selectedId={selectedPositionId}
                onSelect={handleSelectPosition}
              />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-4">
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

                <ConveyorStages
                  position={position}
                  allCells={allCells}
                  selectedAddress={selectedAddress}
                  onSelectCell={handleSelectCell}
                />
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
              allCells={allCells}
            />
          </div>
        </div>
      </div>
    </div>
    </RemonlineProvider>
  );
}

/**
 * Конвейер стадий. Вынесен в отдельный компонент, потому что использует
 * useLiveValueMap (→ useRemonline), а значит должен рендериться ВНУТРИ
 * RemonlineProvider. Пересчитывает формульные ячейки из живых значений
 * зависимостей и прокидывает результат в каждую стадию.
 */
function ConveyorStages({
  position,
  allCells,
  selectedAddress,
  onSelectCell,
}: {
  position: Position;
  allCells: Cell[];
  selectedAddress: string | null;
  onSelectCell: (cell: Cell) => void;
}) {
  const liveValues = useLiveValueMap(allCells);
  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-2">
      <div className="flex min-w-max items-start gap-3">
        {position.stages.map((stage, i) => (
          <div key={stage.id} className="flex items-stretch gap-3">
            <PipelineStage
              stage={stage}
              index={i}
              selectedAddress={selectedAddress}
              onSelectCell={onSelectCell}
              liveValues={liveValues}
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
  );
}

function MobileCatalog({
  positions,
  selectedId,
  onSelect,
}: {
  positions: PositionStub[];
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
                    {p.device} · {p.category}
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
                  {p.finalPrice
                    ? `${p.finalPrice.toLocaleString("ru-RU")} ₽`
                    : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
