"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Smartphone,
  ShieldCheck,
  Clock,
  RotateCcw,
  Check,
} from "lucide-react";
import type { Position } from "@/lib/portal-types";
import {
  setOverride,
  clearOverride,
  useHasOverride,
} from "@/lib/portal-overrides";
import { cn } from "@/lib/utils";

type Props = {
  position: Position;
};

export function PositionHeader({ position }: Props) {
  const finalCell = position.stages
    .flatMap((s) => s.cells)
    .find((c) => c.isFinal);

  const hasOverride = useHasOverride(position.id);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 md:flex-row md:items-center md:justify-between">
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
