import { NextResponse } from "next/server";
import {
  listWarehouses,
  getStock,
  getProductById,
  type RoStockItem,
} from "@/lib/remonline/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Live-остаток одной запчасти.
 *
 * Привязка к товару в РО двухступенчатая:
 *
 *   1. Если в каталоге заполнен `partArticle` (короткий артикул, по
 *      которому РО ищет в `?search=`, например «211149») — идём по нему
 *      сразу: один параллельный обход складов и точный матч по article.
 *
 *   2. Если есть только `partProductId` (внутренний ID товара РО, в
 *      исходной таблице записан как «14870 175» с пробелом-разделителем
 *      тысяч) — `?search=` по нему НЕ работает. Сначала резолвим article
 *      через GET /products/{id}, кэшируем пару (productId → article)
 *      в памяти процесса, дальше шаг 1.
 *
 * Снапшот товаров для всего этого больше не требуется.
 */

/** Кэш product_id → article на время жизни процесса. Карточка товара в РО
 *  меняется крайне редко; на холодном инстансе максимум 1 запрос на
 *  запчасть, на горячем — 0. */
const articleCache = new Map<string, string>();

const stripSpaces = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      key?: string;
      partArticle?: string | null;
      partProductId?: string | null;
      // Старые поля оставляем для обратной совместимости.
      roId?: number;
      roArticle?: string | null;
      warehouseId?: number;
    };

    const explicitArticle = (
      body.partArticle ??
      body.roArticle ??
      ""
    )
      .replace(/\s+/g, "")
      .trim();

    const productId = (body.partProductId ?? "").replace(/\s+/g, "").trim();

    // Резолвим финальный артикул, по которому будем обходить склады.
    let article = explicitArticle;
    let resolvedFromProductId = false;

    if (!article && productId) {
      const cached = articleCache.get(productId);
      if (cached) {
        article = cached;
      } else {
        const card = await getProductById(productId);
        const fromCard = card?.article?.trim() ?? "";
        if (fromCard) {
          article = fromCard;
          articleCache.set(productId, fromCard);
          resolvedFromProductId = true;
        } else {
          return NextResponse.json({
            ok: false,
            error: `В РО не нашлась карточка товара по ID ${productId} — возможно, удалён или ID указан неверно.`,
          });
        }
      }
    }

    if (!article) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "У запчасти не указан ни ID, ни артикул в исходной таблице. Заполните одно из полей.",
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

    // Приоритет: «Сервис» и «Б/У» — основные у клиента, опрашиваем
    // первыми, чтобы быстрее найти ненулевой остаток (но всё равно
    // обходим всё, общий объём складов 16 — это укладывается в 1-2 сек).
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

    const normalizedArticle = stripSpaces(article);

    type WhResult = {
      warehouseId: number;
      warehouseTitle: string;
      quantity: number;
      match: RoStockItem | null;
    };

    const probeWarehouse = async (w: {
      id: number;
      title: string;
    }): Promise<WhResult> => {
      // search в РО индексирован по article и title — для конкретного
      // артикула выдача обычно 1-2 строки.
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
        productId: productId || null,
        resolvedFromProductId,
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
      productId: productId || null,
      resolvedFromProductId,
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
