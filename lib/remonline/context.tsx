"use client";

import {
  createContext,
  useCallback,
  useContext,
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
  residue: number | null;
};

type ServicesSnapshot = {
  takenAt: string;
  total: number;
  items: Record<string, RoServiceMatch>;
};

type ProductsSnapshot = {
  takenAt: string;
  total: number;
  warehouse: { id: number; title: string };
  items: Record<string, RoProductMatch>;
};

// ── Контекст ──────────────────────────────────────────────────────────

/** Live-остаток одной запчасти, запрошенный по кнопке. */
export type StockReading = {
  quantity: number;
  fetchedAt: string;
  perWarehouse?: Array<{ warehouseId: number; quantity: number }>;
  found: boolean;
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

  syncCell: (
    cell: Cell,
    portalValue: number,
  ) => Promise<{ ok: boolean; error?: string }>;

  /** Live-остатки по нормализованному ключу запчасти. */
  stockByKey: Map<string, StockReading>;
  /** Идёт ли запрос остатка для конкретной запчасти. */
  loadingStockKey: string | null;
  /** Запросить остаток одной запчасти прямо сейчас. */
  requestStock: (
    key: string,
    roId?: number,
  ) => Promise<{ ok: boolean; error?: string; reading?: StockReading }>;

  /** Сводка конфликтов по устройствам — для индикаторов в каталоге слева. */
  conflictByDevice: Map<
    string,
    { laborConflicts: number; partConflicts: number; total: number }
  >;
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
      remoteValue: number | null;
      remoteResidue?: number | null;
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
  let residue: number | null | undefined;
  if (m.kind === "service-price") remote = (found as RoServiceMatch).price;
  else if (m.kind === "service-duration")
    remote = (found as RoServiceMatch).duration;
  else if (m.kind === "part-purchase")
    remote = (found as RoProductMatch).purchase;
  else if (m.kind === "part-retail") {
    remote = (found as RoProductMatch).retail;
    residue = (found as RoProductMatch).residue;
  }

  const inSync =
    portalValue !== null && remote !== null && portalValue === remote;

  return {
    state: "resolved",
    roId: found.id,
    roTitle: found.title,
    remoteValue: remote,
    remoteResidue: residue,
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

  const requestStock = useCallback<CtxValue["requestStock"]>(
    async (key, roId) => {
      setLoadingStockKey(key);
      try {
        const res = await fetch("/api/remonline/stock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, roId }),
        });
        const json = await res.json();
        if (!json.ok)
          return { ok: false, error: json.error ?? "Ошибка ответа" };
        const reading: StockReading = {
          quantity: json.quantity ?? 0,
          fetchedAt: json.fetchedAt,
          perWarehouse: json.perWarehouse,
          found: !!json.found,
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
        warehouse: json.warehouse,
        items: json.items,
      });
    } catch (err) {
      setErrorProducts(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  const syncCell = useCallback<CtxValue["syncCell"]>(
    async (cell, portalValue) => {
      if (!cell.roMatch)
        return { ok: false, error: "Ячейка не привязана к РО" };
      const m = cell.roMatch;
      let kind: "service" | "product";
      let roId: number | null = null;
      const patch: Record<string, number> = {};

      if (m.kind === "service-price") {
        kind = "service";
        const found = services?.items[m.key];
        if (!found)
          return { ok: false, error: "Сначала загрузите snapshot услуг" };
        roId = found.id;
        patch.price = portalValue;
      } else if (m.kind === "service-duration") {
        kind = "service";
        const found = services?.items[m.key];
        if (!found)
          return { ok: false, error: "Сначала загрузите snapshot услуг" };
        roId = found.id;
        patch.duration = portalValue;
      } else if (m.kind === "part-retail") {
        kind = "product";
        const found = products?.items[m.key];
        if (!found)
          return { ok: false, error: "Сначала загрузите snapshot запчастей" };
        roId = found.id;
        patch.custom_price = portalValue;
      } else if (m.kind === "part-purchase") {
        kind = "product";
        const found = products?.items[m.key];
        if (!found)
          return { ok: false, error: "Сначала загрузите snapshot запчастей" };
        roId = found.id;
        patch.price = portalValue;
      } else {
        return { ok: false, error: `Неизвестный kind: ${m.kind}` };
      }

      if (roId === null)
        return { ok: false, error: "Не удалось определить roId" };

      try {
        const res = await fetch("/api/remonline/sync-one", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, roId, patch }),
        });
        const json = await res.json();
        if (!json.ok)
          return { ok: false, error: json.error ?? "Ошибка ответа" };

        // Локально обновляем snapshot, чтобы ячейка сразу показала «синхронизировано»
        if (kind === "service" && services) {
          const nextItems = { ...services.items };
          const cur = nextItems[m.key];
          if (cur) {
            nextItems[m.key] = {
              ...cur,
              price: m.kind === "service-price" ? portalValue : cur.price,
              duration:
                m.kind === "service-duration" ? portalValue : cur.duration,
            };
            setServices({ ...services, items: nextItems });
          }
        }
        if (kind === "product" && products) {
          const nextItems = { ...products.items };
          const cur = nextItems[m.key];
          if (cur) {
            nextItems[m.key] = {
              ...cur,
              purchase:
                m.kind === "part-purchase" ? portalValue : cur.purchase,
              retail: m.kind === "part-retail" ? portalValue : cur.retail,
            };
            setProducts({ ...products, items: nextItems });
          }
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [services, products],
  );

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

      if (
        services &&
        fp.roServiceKey &&
        fp.laborPrice !== null
      ) {
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
      syncCell,
      stockByKey,
      loadingStockKey,
      requestStock,
      conflictByDevice,
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
      syncCell,
      stockByKey,
      loadingStockKey,
      requestStock,
      conflictByDevice,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
