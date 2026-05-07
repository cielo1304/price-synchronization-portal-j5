import { NextResponse } from "next/server";
import {
  fetchAllProducts,
  listWarehouses,
} from "@/lib/remonline/client";
import { normalizeName, priceOf } from "@/lib/remonline/normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Snapshot товаров Remonline для матчинга по нормализованному имени.
 * Поскольку у Remonline товары всегда привязаны к складу, snapshot берётся
 * по конкретному складу.
 *
 * Можно явно передать `?warehouse_id=N`, либо `?title=Склад%20Сервис` —
 * найдём склад с этим названием. Если ничего не передано, берём первый
 * склад из списка.
 *
 * Остатки тут НЕ live — приходят вместе с товарами как поле `residue`.
 * Для свежих остатков используется точечный /api/remonline/stock.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const warehouseIdParam = url.searchParams.get("warehouse_id");
    const titleParam = url.searchParams.get("title");

    const warehouses = await listWarehouses();
    if (warehouses.length === 0) {
      return NextResponse.json(
        { ok: false, error: "В Remonline не найдено ни одного склада." },
        { status: 404 },
      );
    }

    let chosen = warehouses[0];
    if (warehouseIdParam) {
      const id = Number(warehouseIdParam);
      const found = warehouses.find((w) => w.id === id);
      if (!found) {
        return NextResponse.json(
          {
            ok: false,
            error: `Склад #${id} не найден. Доступны: ${warehouses.map((w) => `${w.id} «${w.title}»`).join(", ")}`,
          },
          { status: 404 },
        );
      }
      chosen = found;
    } else if (titleParam) {
      const needle = titleParam.toLowerCase().trim();
      const found = warehouses.find((w) =>
        w.title.toLowerCase().includes(needle),
      );
      if (!found) {
        return NextResponse.json(
          {
            ok: false,
            error: `Склад с названием «${titleParam}» не найден. Доступны: ${warehouses.map((w) => `«${w.title}»`).join(", ")}`,
          },
          { status: 404 },
        );
      }
      chosen = found;
    }

    const products = await fetchAllProducts(chosen.id);
    const items: Record<
      string,
      {
        id: number;
        title: string;
        article: string | null;
        purchase: number | null;
        retail: number | null;
      }
    > = {};
    for (const p of products) {
      const key = normalizeName(p.title);
      if (!items[key]) {
        items[key] = {
          id: p.id,
          title: p.title,
          article: p.article ?? null,
          purchase: p.cost ?? null,
          retail: priceOf(p),
        };
      }
    }

    return NextResponse.json({
      ok: true,
      warehouse: { id: chosen.id, title: chosen.title },
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
