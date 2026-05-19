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
 * Привязка строго по `partArticle` — это артикул товара в РО (поле
 * `partId` в исходной таблице, формат «49462 586»). Артикул уникален в
 * пределах базы РО, проиндексирован параметром `?search=` и совпадает
 * 1-к-1 с конкретной номенклатурной позицией.
 *
 * Поэтому никаких snapshot-таблиц для определения остатка не нужно:
 * шлём один параллельный запрос на каждый склад вида
 *   GET /warehouse/goods/{w}?search=49462%20586
 * и фильтруем ответ по точному `article === partArticle`. Если в ответе
 * 0 записей — на этом складе товара нет, quantity=0.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      key?: string;
      // Старые поля оставляем для обратной совместимости с уже
      // развёрнутыми клиентами; основная привязка теперь через partArticle.
      roId?: number;
      roArticle?: string | null;
      partArticle?: string | null;
      warehouseId?: number;
    };

    const article = (body.partArticle ?? body.roArticle ?? "").trim();
    if (!article) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "У запчасти нет partId в каталоге — заполните «ID запчасти» в исходной таблице.",
        },
        { status: 400 },
      );
    }

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

    type WhResult = {
      warehouseId: number;
      warehouseTitle: string;
      quantity: number;
      match: RoStockItem | null;
    };

    /**
     * Сравниваем артикул нечувствительно к пробелам и регистру.
     * В исходной таблице partId хранится как «49462 586» с неразрывным
     * пробелом, в РО артикул может быть «49462586» или «49462 586» —
     * нормализуем оба до сравнения.
     */
    const stripSpaces = (s: string) =>
      s.replace(/\s+/g, "").toLowerCase();
    const normalizedArticle = stripSpaces(article);

    /**
     * Один склад: ищет товар по точному артикулу.
     * Если на этом складе товара нет — quantity=0, match=null.
     */
    const probeWarehouse = async (w: {
      id: number;
      title: string;
    }): Promise<WhResult> => {
      // search в РО индексирован и по article, и по title — для артикула
      // выдача обычно 1-2 строки, чего хватает для точного матча.
      const items = await getStock(w.id, { q: article });
      const match =
        items.find((it) => {
          const a = (it as RoStockItem & { article?: string }).article;
          return a ? stripSpaces(a) === normalizedArticle : false;
        }) ?? null;
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

    // Все склады параллельно: ~16 запросов × 400мс ≈ 600мс.
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
        article,
        fetchedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      ok: true,
      found: true,
      product: {
        id: foundItem.product_id ?? foundItem.id ?? null,
        title: foundItem.product_title ?? foundItem.title ?? "",
        article,
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
