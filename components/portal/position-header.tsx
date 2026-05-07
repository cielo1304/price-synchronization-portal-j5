"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Smartphone,
  ShieldCheck,
  Clock,
  RotateCcw,
  Check,
  AlertTriangle,
  CircleAlert,
  CheckCircle2,
} from "lucide-react";
import type { Position } from "@/lib/portal-types";
import {
  setOverride,
  clearOverride,
  useHasOverride,
} from "@/lib/portal-overrides";
import { useRemonline } from "@/lib/remonline/context";
import { cn } from "@/lib/utils";

type Props = {
  position: Position;
};

export function PositionHeader({ position }: Props) {
  const finalCell = position.stages
    .flatMap((s) => s.cells)
    .find((c) => c.isFinal);

  const hasOverride = useHasOverride(position.id);

  const { services, products } = useRemonline();
  // Считаем расхождения по ячейкам этой позиции — для бейджа в шапке.
  const roSummary = useMemo(() => {
    if (!services && !products)
      return { loaded: false, mismatches: 0, total: 0 };
    let total = 0;
    let mismatches = 0;
    for (const stage of position.stages) {
      for (const cell of stage.cells) {
        if (!cell.roMatch) continue;
        const m = cell.roMatch;
        const isService =
          m.kind === "service-price" || m.kind === "service-duration";
        const snap = isService ? services : products;
        if (!snap) continue;
        const found = snap.items[m.key];
        if (!found) continue;
        total++;
        let remote: number | null = null;
        if (m.kind === "service-price")
          remote = (found as { price: number | null }).price;
        else if (m.kind === "service-duration")
          remote = (found as { duration: number | null }).duration;
        else if (m.kind === "part-purchase")
          remote = (found as { purchase: number | null }).purchase;
        else if (m.kind === "part-retail")
          remote = (found as { retail: number | null }).retail;
        if (cell.value !== null && remote !== null && cell.value !== remote)
          mismatches++;
      }
    }
    return { loaded: true, mismatches, total };
  }, [position, services, products]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>{position.device}</span>
            <ChevronRight className="h-3 w-3" />
            <span>{position.category}</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">{position.variant}</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground text-balance">
            {position.serviceName}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{position.code}</span>

            <EditablePill
              icon={<ShieldCheck className="h-3 w-3" />}
              label="Гарантия"
              value={position.warranty}
              onSave={(next) =>
                setOverride(position.id, { warranty: next })
              }
              parse={(s) => s.trim()}
              format={(v) => v}
              hint="Например: 90 дней"
            />

            <EditablePill
              icon={<Clock className="h-3 w-3" />}
              label="Время работы"
              value={String(position.laborMinutes)}
              suffix=" мин"
              onSave={(next) =>
                setOverride(position.id, { laborMinutes: Number(next) })
              }
              parse={(s) => {
                const n = parseInt(s.replace(/\D/g, ""), 10);
                return Number.isFinite(n) && n >= 0 ? String(n) : null;
              }}
              format={(v) => v}
              hint="В минутах, целое число"
              numeric
            />

            {hasOverride && (
              <button
                type="button"
                onClick={() => clearOverride(position.id)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground transition hover:border-foreground hover:text-foreground"
                title="Сбросить ручные правки этой позиции"
              >
                <RotateCcw className="h-3 w-3" />
                сброс
              </button>
            )}

            {position.draft && (
              <span className="rounded-full border border-dashed border-foreground/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground/70">
                черновик
              </span>
            )}

            {roSummary.loaded && roSummary.total > 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  roSummary.mismatches > 0
                    ? "bg-rose-100 text-rose-700"
                    : "bg-money-muted text-money",
                )}
                title={
                  roSummary.mismatches > 0
                    ? `Расходится с РО ${roSummary.mismatches} из ${roSummary.total} ячеек`
                    : "Все ячейки в синхроне с Remonline"
                }
              >
                {roSummary.mismatches > 0 ? (
                  <>
                    <CircleAlert className="h-3 w-3" />
                    {roSummary.mismatches} c РО
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3 w-3" />в синхроне
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

        {finalCell && finalCell.value !== null && (
          <div className="flex items-center gap-3 rounded-xl border border-money/40 bg-money-muted px-4 py-3">
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Конечная цена
              </div>
              <div className="text-2xl font-semibold tabular-nums text-money">
                {finalCell.value.toLocaleString("ru-RU")} ₽
              </div>
            </div>
          </div>
        )}
      </div>

      {position.noPartWarning && (
        <div className="flex items-start gap-2.5 border-t border-amber-500/30 bg-amber-50 px-5 py-3 text-sm leading-snug text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-pretty">{position.noPartWarning}</span>
        </div>
      )}
    </div>
  );
}

// ── Inline-редактируемая «таблетка» ─────────────────────────────────────
// Кликаешь — превращается в input. Enter / blur сохраняет, Esc отменяет.
function EditablePill({
  icon,
  label,
  value,
  suffix,
  hint,
  numeric,
  onSave,
  parse,
  format,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
  numeric?: boolean;
  onSave: (next: string) => void;
  parse: (raw: string) => string | null;
  format: (v: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // если позиция сменилась — синхронизируем
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const parsed = parse(draft);
    if (parsed !== null && parsed !== value) {
      onSave(parsed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-foreground bg-background px-2 py-0.5 text-[11px]">
        {icon}
        <span className="text-muted-foreground">{label}:</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          inputMode={numeric ? "numeric" : "text"}
          aria-label={`${label}${hint ? ` — ${hint}` : ""}`}
          className="h-4 w-16 bg-transparent text-foreground outline-none"
        />
        {suffix && <span className="text-muted-foreground">{suffix}</span>}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            commit();
          }}
          className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Сохранить"
        >
          <Check className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-[11px]",
        "text-foreground/80 transition hover:border-border hover:bg-card",
      )}
      title={`${label} — кликните, чтобы изменить`}
    >
      {icon}
      <span>
        {format(value)}
        {suffix}
      </span>
    </button>
  );
}
