"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Cell } from "@/lib/portal-types";
import { PRICING_FINGERPRINTS } from "@/lib/portal-catalog";

// ── Snapshot-типы (зеркало серверных) ─────────────────────────────────

export type RoServiceMatch = {
  id: number;
  title: string;
  price: number | null;
  duration: number | null;
};

export type RoProductMatch = {
  id: number;
  title: string;
  article: string | null;
  purchase: number | null;
  retail: number | null;
};

type ServicesSnapshot = {
  takenAt: string;
  total: number;
  items: Record<string, RoServiceMatch>;
};

type ProductsSnapshot = {
  takenAt: string;
  total: number;
  items: Record<string, RoProductMatch>;
};

// ── Контекст ──────────────────────────────────────────────────────────

/** Live-остаток одной запчасти, запрошенный по кнопке. */
export type StockReading = {
  quantity: number;
  fetchedAt: string;
  perWarehouse?: Array<{
    warehouseId: number;
    warehouseTitle: string;
    quantity: number;
  }>;
  found: boolean;
  /** Какой именно идентификатор сработал в `?search=` (если нашли). */
  matchedBy?: { kind: string; value: string } | null;
  /** Все попытки в порядке, в каком сервер их перебирал — для UI-отчёта. */
  tried?: Array<{ kind: string; value: string; hits: number }>;
  /** Полная карточка найденного товара из РО. */
  product?: {
    id: number | string | null;
    title: string;
    article: string | null;
    code: string | null;
    barcode: string | null;
  } | null;
};

type CtxValue = {
  services: ServicesSnapshot | null;
  products: ProductsSnapshot | null;
  loadingServices: boolean;
  loadingProducts: boolean;
  errorServices: string | null;
  errorProducts: string | null;

  loadServices: () => Promise<void>;
  loadProducts: () => Promise<void>;

  /** Live-остатки по нормализованному ключу запчасти. */
  stockByKey: Map<string, StockReading>;
  /** Идёт ли запрос остатка для конкретной запчасти. */
  loadingStockKey: string | null;
  /**
   * Запросить остаток одной запчасти. Можно передать любой набор
   * идентификаторов; сервер перебирает их по убыванию уникальности
   * (штрихкод → артикул → код → ID) и берёт первый, который дал
   * точный матч в РО.
   */
  requestStock: (
    key: string,
    bind: {
      partArticle?: string | null;
      partProductId?: string | null;
      partCode?: string | null;
      partBarcode?: string | null;
    },
  ) => Promise<{ ok: boolean; error?: string; reading?: StockReading }>;

  /** Сводка конфликтов по устройствам — для индикаторов в каталоге слева. */
  conflictByDevice: Map<
    string,
    { laborConflicts: number; partConflicts: number; total: number }
  >;

  /**
   * Переопределить значение / url ячейки в памяти сессии.
   * Используется для inline-редактирования source-ячеек и наценки.
   * Изменения живут только в памяти — никуда не записываются автоматически.
   */
  overrideCell: (address: string, patch: { value?: number | null; url?: string }) => void;

  /**
   * Читать локальные переопределения ячеек.
   * source-ячейки и наценка могут иметь исправленное значение.
   */
  cellOverrides: Map<string, { value?: number | null; url?: string }>;

  /**
   * Убрать локальное переопределение ячейки (например после успешной
   * синхронизации с РО — чтобы значение снова читалось живьём из РО).
   */
  clearOverride: (address: string) => void;

  /**
   * Список дополнительных source-ячеек, добавленных вручную в сессии.
   * Ключ: stageAddress (например "iphone-17.camr.sources"), значение — массив ячеек.
   */
  addedSources: Map<string, Array<{ label: string; url: string; value: number | null }>>;

  /** Добавить новый источник (поставщика) в стейдж источников */
  addSource: (
    stageAddress: string,
    source: { label: string; url: string; value: number | null },
  ) => void;
};

const Ctx = createContext<CtxValue | null>(null);

export function useRemonline(): CtxValue {
  const v = useContext(Ctx);
  if (!v)
    throw new Error("useRemonline должен быть внутри <RemonlineProvider>");
  return v;
}

// ── Резолвер по ячейке ────────────────────────────────────────────────

export type CellRoResolution =
  | { state: "no-match" }
  | { state: "snapshot-missing" }
  | { state: "key-not-found"; expectedKey: string }
  | {
      state: "resolved";
      roId: number;
      roTitle: string;
      /** Артикул товара (для part-*); у services его нет. */
      roArticle: string | null;
      remoteValue: number | null;
      inSync: boolean;
    };

export function useCellRoResolution(
  cell: Cell,
  portalValue: number | null,
): CellRoResolution {
  const { services, products } = useRemonline();
  return useMemo(
    () => resolveCell(services, products, cell, portalValue),
    [services, products, cell, portalValue],
  );
}

function resolveCell(
  services: ServicesSnapshot | null,
  products: ProductsSnapshot | null,
  cell: Cell,
  portalValue: number | null,
): CellRoResolution {
  if (!cell.roMatch) return { state: "no-match" };
  const m = cell.roMatch;
  const isService =
    m.kind === "service-price" || m.kind === "service-duration";
  const snapshot = isService ? services : products;
  if (!snapshot) return { state: "snapshot-missing" };

  const found = snapshot.items[m.key] as
    | RoServiceMatch
    | RoProductMatch
    | undefined;
  if (!found) return { state: "key-not-found", expectedKey: m.key };

  let remote: number | null = null;
  if (m.kind === "service-price") remote = (found as RoServiceMatch).price;
  else if (m.kind === "service-duration")
    remote = (found as RoServiceMatch).duration;
  else if (m.kind === "part-purchase")
    remote = (found as RoProductMatch).purchase;
  else if (m.kind === "part-retail") remote = (found as RoProductMatch).retail;

  const inSync =
    portalValue !== null && remote !== null && portalValue === remote;

  // article есть только у товаров; у услуг — null
  const roArticle = isService
    ? null
    : ((found as RoProductMatch).article ?? null);

  return {
    state: "resolved",
    roId: found.id,
    roTitle: found.title,
    roArticle,
    remoteValue: remote,
    inSync,
  };
}

// ── Provider ──────────────────────────────────────────────────────────

export function RemonlineProvider({ children }: { children: React.ReactNode }) {
  const [services, setServices] = useState<ServicesSnapshot | null>(null);
  const [products, setProducts] = useState<ProductsSnapshot | null>(null);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [errorServices, setErrorServices] = useState<string | null>(null);
  const [errorProducts, setErrorProducts] = useState<string | null>(null);

  // Live-остатки запрашиваются по требованию: нажал кнопку у запчасти —
  // дёрнули РО, ответ записали в Map. Map переживает свёртывание ячейки.
  const [stockByKey, setStockByKey] = useState<Map<string, StockReading>>(
    () => new Map(),
  );
  const [loadingStockKey, setLoadingStockKey] = useState<string | null>(null);

  // Локальные переопределения ячеек (value, url) — только в памяти сессии.
  const [cellOverrides, setCellOverrides] = useState<
    Map<string, { value?: number | null; url?: string }>
  >(() => new Map());

  // Вручную добавленные source-ячейки (поставщики).
  const [addedSources, setAddedSources] = useState<
    Map<string, Array<{ label: string; url: string; value: number | null }>>
  >(() => new Map());

  const overrideCell = useCallback(
    (address: string, patch: { value?: number | null; url?: string }) => {
      setCellOverrides((prev) => {
        const next = new Map(prev);
        const existing = next.get(address) ?? {};
        next.set(address, { ...existing, ...patch });
        return next;
      });
    },
    [],
  );

  const addSource = useCallback(
    (
      stageAddress: string,
      source: { label: string; url: string; value: number | null },
    ) => {
      setAddedSources((prev) => {
        const next = new Map(prev);
        const arr = next.get(stageAddress) ?? [];
        next.set(stageAddress, [...arr, source]);
        return next;
      });
    },
    [],
  );

  const clearOverride = useCallback((address: string) => {
    setCellOverrides((prev) => {
      if (!prev.has(address)) return prev;
      const next = new Map(prev);
      next.delete(address);
      return next;
    });
  }, []);

  const requestStock = useCallback<CtxValue["requestStock"]>(
    async (key, bind) => {
      setLoadingStockKey(key);
      try {
        const res = await fetch("/api/remonline/stock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key,
            partArticle: bind.partArticle ?? null,
            partProductId: bind.partProductId ?? null,
            partCode: bind.partCode ?? null,
            partBarcode: bind.partBarcode ?? null,
          }),
        });
        const json = await res.json();
        if (!json.ok)
          return { ok: false, error: json.error ?? "Ошибка ответа" };
        const reading: StockReading = {
          quantity: json.quantity ?? 0,
          fetchedAt: json.fetchedAt,
          perWarehouse: json.perWarehouse,
          found: !!json.found,
          matchedBy: json.matchedBy ?? null,
          tried: json.tried ?? [],
          product: json.product ?? null,
        };
        setStockByKey((prev) => {
          const next = new Map(prev);
          next.set(key, reading);
          return next;
        });
        return { ok: true, reading };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        setLoadingStockKey(null);
      }
    },
    [],
  );

  const loadServices = useCallback(async () => {
    setLoadingServices(true);
    setErrorServices(null);
    try {
      const res = await fetch("/api/remonline/snapshot/services", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Ошибка ответа");
      setServices({
        takenAt: json.takenAt,
        total: json.total,
        items: json.items,
      });
    } catch (err) {
      setErrorServices(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingServices(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    setErrorProducts(null);
    try {
      const res = await fetch("/api/remonline/snapshot/products", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Ошибка ответа");
      setProducts({
        takenAt: json.takenAt,
        total: json.total,
        items: json.items,
      });
    } catch (err) {
      setErrorProducts(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  // Авто-загрузка snapshot РО один раз при монтировании портала.
  // Провайдер монтируется один раз на корне PortalShell (не пересоздаётся
  // при смене позиции), поэтому это один запрос на загрузку страницы.
  // Благодаря этому ячейки сразу показывают ЖИВУЮ цену из РО, а не
  // статичный слепок Google-таблицы.
  useEffect(() => {
    loadServices();
    loadProducts();
  }, [loadServices, loadProducts]);

  // ── Сводка конфликтов по устройствам ────────────────────────────────
  // Считается мемоизированно при изменении snapshot: один проход по
  // PRICING_FINGERPRINTS даёт цифру для каждой модели каталога.
  const conflictByDevice = useMemo(() => {
    const map = new Map<
      string,
      { laborConflicts: number; partConflicts: number; total: number }
    >();
    if (!services && !products) return map;

    for (const fp of PRICING_FINGERPRINTS) {
      let labor = 0;
      let part = 0;

      if (services && fp.roServiceKey && fp.laborPrice !== null) {
        const m = services.items[fp.roServiceKey];
        if (m && m.price !== null && m.price !== fp.laborPrice) labor++;
      }

      if (products && fp.roPartKey) {
        const m = products.items[fp.roPartKey];
        if (m) {
          if (
            fp.partRetail !== null &&
            m.retail !== null &&
            m.retail !== fp.partRetail
          )
            part++;
          if (
            fp.partPurchase !== null &&
            m.purchase !== null &&
            m.purchase !== fp.partPurchase
          )
            part++;
        }
      }

      if (labor > 0 || part > 0) {
        const cur = map.get(fp.device) ?? {
          laborConflicts: 0,
          partConflicts: 0,
          total: 0,
        };
        cur.laborConflicts += labor;
        cur.partConflicts += part;
        cur.total += labor + part;
        map.set(fp.device, cur);
      }
    }
    return map;
  }, [services, products]);

  const value: CtxValue = useMemo(
    () => ({
      services,
      products,
      loadingServices,
      loadingProducts,
      errorServices,
      errorProducts,
      loadServices,
      loadProducts,
      stockByKey,
      loadingStockKey,
      requestStock,
      conflictByDevice,
      overrideCell,
      cellOverrides,
      clearOverride,
      addedSources,
      addSource,
    }),
    [
      services,
      products,
      loadingServices,
      loadingProducts,
      errorServices,
      errorProducts,
      loadServices,
      loadProducts,
      stockByKey,
      loadingStockKey,
      requestStock,
      conflictByDevice,
      overrideCell,
      cellOverrides,
      clearOverride,
      addedSources,
      addSource,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
