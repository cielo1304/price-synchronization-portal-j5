import { NextResponse } from "next/server";
import {
  listWarehouses,
  getStock,
  type RoStockItem,
} from "@/lib/remonline/client";
import { normalizeName } from "@/lib/remonline/normalize";

export const runtime = "nodejs";

/**
 * Live-остаток одной запчасти. v2: GET /v2/stock?warehouse_id=N&q=...
 *
 * Принимает либо `roId` (если уже знаем точный товар),
 * либо `key` (нормализованное имя — портал шлёт его при клике на ячейку).
 *
 * Если склад не указан — обходит все склады и суммирует остатки.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      roId?: number;
      key?: string;
      title?: string;
      warehouseId?: number;
    };

    if (!body.roId && !body.key && !body.title) {
      return NextResponse.json(
        { ok: false, error: "Нужно указать roId, key или title" },
        { status: 400 },
      );
    }

    const warehouseIds = body.warehouseId
      ? [body.warehouseId]
      : (await listWarehouses()).map((w) => w.id);

    if (warehouseIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "В Remonline нет ни одного склада" },
        { status: 400 },
      );
    }

    // Стратегия запроса: если знаем точный roId — фильтруем по нему,
    // иначе ищем по `q` (Remonline сам ищет в title/article/barcode).
    const filter: { ids?: number[]; q?: string; title?: string } = {};
    if (body.roId) filter.ids = [body.roId];
    else if (body.title) filter.title = body.title;
    else if (body.key) filter.q = body.key;

    let totalQty = 0;
    let foundItem: RoStockItem | null = null;
    const perWarehouse: Array<{ warehouseId: number; quantity: number }> = [];

    // Идём по складам последовательно, чтобы не упереться в rate limit (3 req/sec).
    for (const wid of warehouseIds) {
      const items = await getStock(wid, filter);
      // Когда фильтр по `q` или `title` — РО может вернуть несколько похожих
      // товаров; берём тот, у которого нормализованное имя точно совпадает.
      const match =
        items.find((it) => {
          if (body.roId) return (it.product_id ?? it.id) === body.roId;
          if (body.key)
            return (
              normalizeName(it.product_title ?? it.title ?? "") === body.key
            );
          if (body.title) return (it.product_title ?? it.title) === body.title;
          return false;
        }) ??
        // если точного матча не нашлось — берём первый, что отдал РО
        items[0];

      if (match) {
        const qty = Number(
          match.residue ?? match.quantity ?? match.amount ?? 0,
        );
        totalQty += qty;
        perWarehouse.push({ warehouseId: wid, quantity: qty });
        foundItem = match;
      }
    }

    if (!foundItem) {
      return NextResponse.json({
        ok: true,
        found: false,
        fetchedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      ok: true,
      found: true,
      product: {
        id: foundItem.product_id ?? foundItem.id ?? null,
        title: foundItem.product_title ?? foundItem.title ?? "",
      },
      quantity: totalQty,
      perWarehouse,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Неизвестная ошибка",
      },
      { status: 500 },
    );
  }
}
