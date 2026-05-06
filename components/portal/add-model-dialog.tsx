"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Copy, FilePlus, Trash2, Check } from "lucide-react";
import type { PositionStub } from "@/lib/portal-types";
import {
  addCustomModel,
  removeCustomModel,
  useCustomModels,
} from "@/lib/portal-custom-models";
import { extractServiceTemplates } from "@/lib/portal-catalog";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Полный каталог (база + кастомы), используется для списка моделей-источников */
  positions: PositionStub[];
  /** Колбэк после создания — например, выбрать первую новую позицию */
  onCreated?: (firstPositionId: string | null) => void;
};

type Mode = "copy" | "empty";

export function AddModelDialog({
  open,
  onClose,
  positions,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("copy");
  const [sourceDevice, setSourceDevice] = useState<string>("");
  const customModels = useCustomModels();
  const inputRef = useRef<HTMLInputElement>(null);

  // Список моделей-источников — только базовые, без custom
  const baseDevices = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const p of positions) {
      // custom-позиции имеют id вида "custom.…"
      if (p.id.startsWith("custom.")) continue;
      if (!seen.has(p.device)) {
        seen.add(p.device);
        result.push(p.device);
      }
    }
    return result;
  }, [positions]);

  // По умолчанию выбираем самую новую модель (первая в списке после deviceSortKey)
  useEffect(() => {
    if (!sourceDevice && baseDevices.length > 0) {
      setSourceDevice(baseDevices[0]);
    }
  }, [baseDevices, sourceDevice]);

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setName("");
        setMode("copy");
      }, 200);
    } else {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Esc закрывает
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const sourceServiceCount = useMemo(() => {
    if (mode !== "copy" || !sourceDevice) return 0;
    return positions.filter(
      (p) => !p.id.startsWith("custom.") && p.device === sourceDevice,
    ).length;
  }, [mode, sourceDevice, positions]);

  const trimmed = name.trim();
  const nameTaken = useMemo(() => {
    const lower = trimmed.toLowerCase();
    if (!lower) return false;
    if (
      baseDevices.some((d) => d.toLowerCase() === lower) ||
      customModels.some((m) => m.device.toLowerCase() === lower)
    ) {
      return true;
    }
    return false;
  }, [trimmed, baseDevices, customModels]);

  const canSubmit = trimmed.length >= 2 && !nameTaken;

  function handleSubmit() {
    if (!canSubmit) return;
    const services =
      mode === "copy" && sourceDevice
        ? extractServiceTemplates(sourceDevice)
        : [];
    const created = addCustomModel({
      device: trimmed,
      services,
      copiedFrom: mode === "copy" ? sourceDevice : null,
    });
    const firstId =
      created.services.length > 0
        ? `custom.${created.id}.0`
        : null;
    onCreated?.(firstId);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-model-title"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="add-model-title"
              className="text-base font-semibold text-foreground"
            >
              Добавить модель
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Новая модель появится в каталоге слева. Услуги можно скопировать из
              существующей — конвейер цен будет пустой, заполните вручную.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="model-name"
              className="text-xs font-medium text-foreground"
            >
              Название модели
            </label>
            <input
              ref={inputRef}
              id="model-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) handleSubmit();
              }}
              placeholder="Например: iPhone 18 Pro Max"
              className={cn(
                "h-10 rounded-lg border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-foreground",
                nameTaken
                  ? "border-destructive focus:border-destructive"
                  : "border-border",
              )}
            />
            {nameTaken && (
              <p className="text-[11px] text-destructive">
                Модель с таким названием уже есть
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-foreground">
              Услуги новой модели
            </div>
            <div className="grid gap-2">
              <ModeOption
                active={mode === "copy"}
                onClick={() => setMode("copy")}
                icon={<Copy className="h-4 w-4" />}
                title="Скопировать из существующей модели"
                subtitle={
                  sourceDevice
                    ? `${sourceServiceCount} услуг будет создано из «${sourceDevice}»`
                    : "Выберите модель-источник ниже"
                }
              />
              <ModeOption
                active={mode === "empty"}
                onClick={() => setMode("empty")}
                icon={<FilePlus className="h-4 w-4" />}
                title="Пустая модель"
                subtitle="Без услуг — добавите их позже вручную"
              />
            </div>
          </div>

          {mode === "copy" && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="source-device"
                className="text-xs font-medium text-foreground"
              >
                Скопировать услуги из
              </label>
              <select
                id="source-device"
                value={sourceDevice}
                onChange={(e) => setSourceDevice(e.target.value)}
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-foreground"
              >
                {baseDevices.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Структура услуг и наличие запчастей сохранятся. Цены, источники
                и наценки нужно ввести заново.
              </p>
            </div>
          )}
        </div>

        {customModels.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card/40 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Уже добавлено · {customModels.length}
            </div>
            <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
              {customModels.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">
                      {m.device}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {m.services.length} услуг ·{" "}
                      {m.copiedFrom
                        ? `скопировано из «${m.copiedFrom}»`
                        : "пустая"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `Удалить модель «${m.device}» и все её услуги?`,
                        )
                      ) {
                        removeCustomModel(m.id);
                      }
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Удалить ${m.device}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="h-4 w-4" />
            Создать модель
          </button>
        </footer>
      </div>
    </div>
  );
}

function ModeOption({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-left transition",
        active
          ? "border-foreground bg-foreground/5"
          : "border-border bg-background hover:border-foreground/40",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          active
            ? "bg-foreground text-background"
            : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm font-medium",
            active ? "text-foreground" : "text-foreground/80",
          )}
        >
          {title}
        </div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {subtitle}
        </div>
      </div>
    </button>
  );
}
