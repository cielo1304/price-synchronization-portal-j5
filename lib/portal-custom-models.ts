"use client";

import { useSyncExternalStore } from "react";

/**
 * Стор пользовательских моделей и их услуг.
 * Каждая модель хранит шаблоны услуг — без цен, только структура.
 * Когда выйдет iPhone 18, пользователь скопирует услуги из 17-го —
 * получит весь набор услуг с пустым конвейером цен.
 *
 * Бэкенд — localStorage. Когда переедем на Supabase, поменяются только read/write.
 */

export type CustomService = {
  /** Полное название услуги, как в исходной таблице */
  serviceName: string;
  /** Категория для группировки (Дисплей, Аккумулятор...) */
  category: string;
  /** Вариант исполнения (СНЯТЫЙ ОРИГИНАЛ (бу), Замена...) */
  variant: string;
  /** Есть ли в услуге запчасть (нужно для конвейера цен) */
  hasPart: boolean;
  /** Гарантия в днях (по умолчанию из шаблона) */
  warrantyDays: number | null;
  /** Длительность работы как строка ("30 мин") */
  laborDuration: string | null;
};

export type CustomModel = {
  /** Стабильный id модели */
  id: string;
  /** Отображаемое название (например "iPhone 18 Pro Max") */
  device: string;
  /** Поколение для группировки в фильтрах ("iPhone 18") */
  family: string;
  /** Имя модели-источника, из которой скопированы услуги */
  copiedFrom: string | null;
  /** Когда создана */
  createdAt: number;
  /** Шаблоны услуг */
  services: CustomService[];
};

const STORAGE_KEY = "maxmobiles.portal.custom_models.v1";

let cache: CustomModel[] | null = null;
const listeners = new Set<() => void>();

function read(): CustomModel[] {
  if (cache !== null) return cache;
  if (typeof window === "undefined") {
    cache = [];
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as CustomModel[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: CustomModel[]) {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // игнорируем переполнение
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: CustomModel[] = [];

export function getCustomModels(): CustomModel[] {
  return read();
}

export function addCustomModel(input: {
  device: string;
  services: CustomService[];
  copiedFrom: string | null;
}): CustomModel {
  const id = `${slugify(input.device)}-${Math.random().toString(36).slice(2, 7)}`;
  const family = computeFamily(input.device);
  const model: CustomModel = {
    id,
    device: input.device.trim(),
    family,
    copiedFrom: input.copiedFrom,
    createdAt: Date.now(),
    services: input.services,
  };
  write([...read(), model]);
  return model;
}

export function removeCustomModel(id: string) {
  write(read().filter((m) => m.id !== id));
}

/** React-хук — возвращает живой список и перерисовывает при изменении */
export function useCustomModels(): CustomModel[] {
  return useSyncExternalStore(
    subscribe,
    () => read(),
    () => EMPTY,
  );
}

// ── Утилиты ──────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "model"
  );
}

function computeFamily(device: string): string {
  if (/iPhone\s+SE/i.test(device)) return "iPhone SE";
  if (/iPhone\s+X(?!\d)/i.test(device)) return "iPhone X-серия";
  const m = device.match(/iPhone\s+(\d+E?)/i);
  return m ? `iPhone ${m[1]}` : device;
}
