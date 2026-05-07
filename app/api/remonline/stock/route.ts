import { NextResponse } from "next/server";
import {
  listWarehouses,
  getStock,
  type RoStockItem,
} from "@/lib/remonline/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Live-остаток одной запчасти.
 *
 * Привязка строго по `roId` — идентификатору товара в РО, который мы знаем
 * из snapshot товаров. Никаких поисков по словам / нормализованному имени:
 * у каждой запчасти в портале есть железная связь с одной записью в РО,
 * её и используем.
 *
 * Параметр `roArticle` помогает РО сузить выдачу до 1-2 записей через
 * `?search=<article>`. Если артикул отсутствует — тянем первую страницу
 * товаров склада и фильтруем локально по id.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      key?: string;
      roId?: number;
      roArticle?: string | null;
      warehouseId?: number;
    };

    if (!body.roId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Нет привязки к РО. Загрузите snapshot товаров — он сопоставит запчасти по ID.",
        },
        { status: 400 },
      );
    }
    const roId = body.roId;

    const allWarehouses = await listWarehouses();
    if (allWarehouses.length === 0) {
      return NextResponse.json(
        { ok: false, error: "В Remonline нет ни одного склада" },
        { status: 400 },
      );
    }

    // Приоритет: «Склад Сервис» и «Склад Б/У» — основные у клиента,
    // их опрашиваем первыми, чтобы быстрее найти ненулевой остаток.
    const isPrimary = (title: string) => {
      const t = title.toLowerCase();
      return t.includes("сервис") || t.includes("б/у") || t.includes("бу");
    };
    const orderedWarehouses = [...allWarehouses].sort((a, b) => {
      const ap = isPrimary(a.title) ? 0 : 1;
      const bp = isPrimary(b.title) ? 0 : 1;
      return ap - bp;
    });

    const warehouses = body.warehouseId
      ? orderedWarehouses.filter((w) => w.id === body.warehouseId)
      : orderedWarehouses;

    // Если есть артикул — search по нему точно сузит выдачу до нескольких
    // записей. Если нет — search не передаём, тянем первую страницу
    // (50 товаров) и ищем нужный id локально.
    const filter: { q?: string } = body.roArticle
      ? { q: body.roArticle }
      : {};

    type WhResult = {
      warehouseId: number;
      warehouseTitle: string;
      quantity: number;
      match: RoStockItem | null;
    };

    /**
     * Один склад: ищет ровно тот товар, чей id === roId. Никакого fuzzy.
     * Если на этом складе товара нет — quantity=0, match=null.
     */
    const probeWarehouse = async (w: {
      id: number;
      title: string;
    }): Promise<WhResult> => {
      const items = await getStock(w.id, filter);
      const match =
        items.find((it) => (it.product_id ?? it.id) === roId) ?? null;
      const qty = match
        ? Number(match.residue ?? match.quantity ?? match.amount ?? 0)
        : 0;
      return {
        warehouseId: w.id,
        warehouseTitle: w.title,
        quantity: qty,
        match,
      };
    };

    // Все склады параллельно: 16 запросов × ~400мс ≈ 600мс с учётом
    // конкурентности vs ~10 сек последовательно.
    const results = await Promise.all(warehouses.map(probeWarehouse));

    let totalQty = 0;
    let foundItem: RoStockItem | null = null;
    const perWarehouse: Array<{
      warehouseId: number;
      warehouseTitle: string;
      quantity: number;
    }> = [];

    for (const r of results) {
      if (r.match) {
        totalQty += r.quantity;
        perWarehouse.push({
          warehouseId: r.warehouseId,
          warehouseTitle: r.warehouseTitle,
          quantity: r.quantity,
        });
        foundItem = r.match;
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
