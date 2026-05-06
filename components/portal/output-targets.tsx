"use client";

import { CheckCircle2, Clock, AlertCircle, Globe, Boxes, Wrench } from "lucide-react";
import type { Output } from "@/lib/portal-types";
import { cn } from "@/lib/utils";

const STATUS_META = {
  synced: { label: "Синхронизировано", icon: CheckCircle2, className: "text-money" },
  pending: { label: "Ожидает", icon: Clock, className: "text-foreground/60" },
  error: { label: "Ошибка", icon: AlertCircle, className: "text-destructive" },
} as const;

const ICONS = {
  site: Globe,
  moysklad: Boxes,
  remonline: Wrench,
} as const;

type Props = {
  outputs: Output[];
  onSelectAddress: (address: string) => void;
};

export function OutputTargets({ outputs, onSelectAddress }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-muted-foreground">→</span>
        <h3 className="text-sm font-semibold text-foreground">Куда уходит цена</h3>
      </div>
      <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
        Финальные значения автоматически попадают в подключённые системы
      </p>

      <div className="grid gap-3 md:grid-cols-3">
        {outputs.map((out) => {
          const status = STATUS_META[out.status];
          const StatusIcon = status.icon;
          const SystemIcon = ICONS[out.id];

          return (
            <div
              key={out.id}
              className="flex flex-col gap-3 rounded-xl border border-money/30 bg-money-muted/40 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-money text-money-foreground">
                    <SystemIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-tight text-foreground">
                      {out.name}
                    </div>
                    <div className="text-[11px] leading-tight text-muted-foreground">
                      {out.description}
                    </div>
                  </div>
                </div>
                <StatusIcon className={cn("h-4 w-4 shrink-0", status.className)} />
              </div>

              <div className="flex flex-col gap-1.5">
                {out.fields.map((f) => (
                  <button
                    key={f.fromAddress + f.label}
                    type="button"
                    onClick={() => onSelectAddress(f.fromAddress)}
                    className="flex items-center justify-between gap-2 rounded-md bg-card px-2.5 py-2 text-left transition hover:ring-1 hover:ring-foreground/20"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-foreground">
                        {f.label}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground/80">
                        ← {f.fromAddress}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {f.value.toLocaleString("ru-RU")} ₽
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full", out.status === "synced" ? "bg-money" : "bg-foreground/40")} />
                {status.label} · {out.lastSyncedAt}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
