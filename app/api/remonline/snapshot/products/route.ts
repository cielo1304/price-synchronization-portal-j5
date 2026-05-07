import { NextResponse } from "next/server";
import { fetchAllProducts, listWarehouses } from "@/lib/remonline/client";
import { normalizeName, priceOf } from "@/lib/remonline/normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Snapshot товаров склада. По умолчанию берётся первый склад.
 * Возвращает Record<key, RoProductMatch> с остатками для real-time индикации.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const warehouseIdParam = url.searchParams.get("warehouse");

    const warehouses = await listWarehouses();
    if (warehouses.length === 0) {
      return NextResponse.json(
        { ok: false, error: "В Remonline не найдено ни одного склада" },
        { status: 400 },
      );
    }
    const warehouse = warehouseIdParam
      ? (warehouses.find((w) => String(w.id) === warehouseIdParam) ??
        warehouses[0])
      : warehouses[0];

    const products = await fetchAllProducts(warehouse.id);
    const items: Record<
      string,
      {
        id: number;
        title: string;
        article: string | null;
        purchase: number | null;
        retail: number | null;
        residue: number | null;
      }
    > = {};
    for (const p of products) {
      const key = normalizeName(p.title);
      if (!items[key]) {
        items[key] = {
          id: p.id,
          title: p.title,
          article: p.article ?? null,
          purchase: p.price ?? null,
          retail: priceOf(p),
          residue: typeof p.residue === "number" ? p.residue : null,
        };
      }
    }

    return NextResponse.json({
      ok: true,
      warehouse: { id: warehouse.id, title: warehouse.title },
      warehouses: warehouses.map((w) => ({ id: w.id, title: w.title })),
      total: products.length,
      uniqueKeys: Object.keys(items).length,
      takenAt: new Date().toISOString(),
      items,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
