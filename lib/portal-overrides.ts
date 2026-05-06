"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Локальный стор пользовательских правок поверх данных портала.
 *
 * Сейчас бэкенд — браузерный localStorage. Когда переедем на Supabase,
 * единственное место, которое нужно поменять — функции read/write ниже.
 *
 * Стор хранит частичные оверрайды для каждой позиции:
 *   { [positionId]: { warranty?: string, laborMinutes?: number } }
 */

export type PositionOverride = {
  warranty?: string;
  laborMinutes?: number;
};

type Store = Record<string, PositionOverride>;

const STORAGE_KEY = "maxmobiles.portal.overrides.v1";

let cache: Store | null = null;
const listeners = new Set<() => void>();

function read(): Store {
  if (cache !== null) return cache;
  if (typeof window === "undefined") {
    cache = {};
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Store) {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // игнорируем переполнение/блокировку storage
    }
  }
  listeners.forEach((l) => l());
}

export function getOverride(id: string): PositionOverride | undefined {
  return read()[id];
}

export function setOverride(id: string, patch: PositionOverride) {
  const store = read();
  const current = store[id] ?? {};
  const merged: PositionOverride = { ...current, ...patch };
  // если ключ undefined — удаляем
  for (const k of Object.keys(merged) as Array<keyof PositionOverride>) {
    if (merged[k] === undefined) delete merged[k];
  }
  const next: Store = { ...store, [id]: merged };
  if (Object.keys(merged).length === 0) delete next[id];
  write(next);
}

export function clearOverride(id: string) {
  const store = read();
  if (!(id in store)) return;
  const next = { ...store };
  delete next[id];
  write(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Хук возвращает текущий override для конкретной позиции.
 * Перерисовывает компонент при изменении.
 */
export function useOverride(id: string): PositionOverride | undefined {
  // SSR-безопасный snapshot: возвращаем undefined на сервере
  const snapshot = useSyncExternalStore(
    subscribe,
    () => read()[id],
    () => undefined,
  );
  return snapshot;
}

/**
 * Хук возвращает true, если для позиции есть хоть одно ручное изменение.
 * Полезно показать индикатор "изменено" в UI.
 */
export function useHasOverride(id: string): boolean {
  const o = useOverride(id);
  return !!o && Object.keys(o).length > 0;
}

/**
 * Безопасное чтение всего стора в клиентских компонентах после mount
 * (используется только если нужно перечислить все правки).
 */
export function useAllOverrides(): Store {
  const [snap, setSnap] = useState<Store>(() =>
    typeof window === "undefined" ? {} : read(),
  );
  useEffect(() => {
    setSnap(read());
    return subscribe(() => setSnap({ ...read() }));
  }, []);
  return snap;
}
