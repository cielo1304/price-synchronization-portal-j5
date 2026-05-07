import { NextResponse } from "next/server";
import {
  fetchAllServices,
  fetchAllProducts,
  listWarehouses,
  type RoProduct,
  type RoService,
} from "@/lib/remonline/client";
import positions from "@/lib/portal-positions.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Сухой прогон: тянем actuals из РО, сопоставляем с порталом, считаем diff.
 * НИЧЕГО НЕ ПИШЕМ. Возвращаем массив изменений, который покажет UI.
 */

type PortalRecord = {
  id: string;
  device: string;
  service: string;
  partName?: string | null;
  laborPrice?: number | null;
  laborDuration?: number | null;
  partRetail?: number | null;
  partPurchase?: number | null;
  finalPrice?: number | null;
};

type Diff = {
  positionId: string;
  device: string;
  service: string;
  /** Услуга в РО (если нашли) */
  matchedService?: { id: number; title: string };
  /** Запчасть в РО (если нашли) */
  matchedProduct?: { id: number; title: string; residue?: number | null };
  changes: Array<{
    field: string;
    portalValue: number | string | null;
    remonlineValue: number | string | null;
    action: "would_update" | "in_sync" | "missing_in_ro";
  }>;
};

/** Нормализация для сопоставления имён */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ёе]/g, "е")
    .replace(/[\[\]()]/g, " ")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function buildIndex<T extends { title: string }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const it of items) {
    const key = normalize(it.title);
    if (!map.has(key)) map.set(key, it);
  }
  return map;
}

function priceOf(s: { price?: number | null; prices?: Array<{ price: number }> } | undefined) {
  if (!s) return null;
  if (typeof s.price === "number") return s.price;
  if (s.prices && s.prices.length > 0) return s.prices[0].price;
  return null;
}

export async function POST() {
  try {
    const warehouses = await listWarehouses();
    if (warehouses.length === 0) {
      return NextResponse.json(
        { ok: false, error: "В Remonline не найдено ни одного склада" },
        { status: 400 },
      );
    }
    const warehouse = warehouses[0];

    const [services, products] = await Promise.all([
      fetchAllServices(),
      fetchAllProducts(warehouse.id),
    ]);

    const svcIndex = buildIndex<RoService>(services);
    const prodIndex = buildIndex<RoProduct>(products);

    const diffs: Diff[] = [];
    let inSync = 0;
    let wouldUpdate = 0;
    let missingInRo = 0;

    // Превращаем сырые записи каталога в простую структуру для сравнения
    const portalRecords: PortalRecord[] = (positions as Array<Record<string, unknown>>).map(
      (rec) => {
        const part = rec.part as
          | { name?: string; purchase?: number; retailRO?: number }
          | undefined;
        const labor = rec.labor as
          | { price?: number; duration?: string }
          | undefined;
        return {
          id: rec.id as string,
          device: rec.model as string,
          service: rec.service as string,
          partName: part?.name ?? null,
          partPurchase: part?.purchase ?? null,
          partRetail: part?.retailRO ?? null,
          laborPrice: labor?.price ?? null,
          laborDuration: parseInt(String(labor?.duration ?? "0"), 10) || null,
          finalPrice: rec.finalPrice as number | null,
        };
      },
    );

    for (const rec of portalRecords) {
      const matchedService = svcIndex.get(normalize(rec.service));
      const matchedProduct = rec.partName
        ? prodIndex.get(normalize(rec.partName))
        : undefined;

      const changes: Diff["changes"] = [];

      // Сравнение услуг
      if (matchedService) {
        const roPrice = priceOf(matchedService);
        if (rec.laborPrice !== null && roPrice !== rec.laborPrice) {
          changes.push({
            field: "labor.price",
            portalValue: rec.laborPrice ?? null,
            remonlineValue: roPrice ?? null,
            action: "would_update",
          });
        } else if (roPrice !== null) {
          changes.push({
            field: "labor.price",
            portalValue: rec.laborPrice ?? null,
            remonlineValue: roPrice,
            action: "in_sync",
          });
        }
        if (
          rec.laborDuration !== null &&
          matchedService.duration !== rec.laborDuration
        ) {
          changes.push({
            field: "labor.duration",
            portalValue: rec.laborDuration ?? null,
            remonlineValue: matchedService.duration ?? null,
            action: "would_update",
          });
        }
      } else if (rec.laborPrice !== null) {
        changes.push({
          field: "labor.price",
          portalValue: rec.laborPrice ?? null,
          remonlineValue: null,
          action: "missing_in_ro",
        });
      }

      // Сравнение запчастей
      if (rec.partName && matchedProduct) {
        const roRetail = priceOf(matchedProduct);
        if (rec.partRetail !== null && roRetail !== rec.partRetail) {
          changes.push({
            field: "part.retail",
            portalValue: rec.partRetail ?? null,
            remonlineValue: roRetail ?? null,
            action: "would_update",
          });
        }
        if (
          rec.partPurchase !== null &&
          matchedProduct.price !== rec.partPurchase
        ) {
          changes.push({
            field: "part.purchase",
            portalValue: rec.partPurchase ?? null,
            remonlineValue: matchedProduct.price ?? null,
            action: "would_update",
          });
        }
      } else if (rec.partName) {
        changes.push({
          field: "part",
          portalValue: rec.partName,
          remonlineValue: null,
          action: "missing_in_ro",
        });
      }

      // Считаем статистику
      for (const c of changes) {
        if (c.action === "in_sync") inSync++;
        else if (c.action === "would_update") wouldUpdate++;
        else missingInRo++;
      }

      // В отчёт попадают только те, у кого есть отличия от РО
      if (changes.some((c) => c.action !== "in_sync")) {
        diffs.push({
          positionId: rec.id,
          device: rec.device,
          service: rec.service,
          matchedService: matchedService
            ? { id: matchedService.id, title: matchedService.title }
            : undefined,
          matchedProduct: matchedProduct
            ? {
                id: matchedProduct.id,
                title: matchedProduct.title,
                residue: matchedProduct.residue,
              }
            : undefined,
          changes,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      warehouse: { id: warehouse.id, title: warehouse.title },
      stats: {
        portalPositions: portalRecords.length,
        roServices: services.length,
        roProducts: products.length,
        inSync,
        wouldUpdate,
        missingInRo,
        diffs: diffs.length,
      },
      // Возвращаем не более 200 строк, чтобы UI не лагал
      diffs: diffs.slice(0, 200),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
