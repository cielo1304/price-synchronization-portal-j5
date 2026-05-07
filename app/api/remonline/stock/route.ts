import { NextResponse } from "next/server";
import {
  listWarehouses,
  getStock,
  type RoStockItem,
} from "@/lib/remonline/client";
import { normalizeName } from "@/lib/remonline/normalize";

export const runtime = "nodejs";
// Несколько складов × 30 сек таймаут на запрос — даём максимум.
export const maxDuration = 60;

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

    // Тянем полный список складов даже если warehouseId передан явно —
    // нужен `title` для подписи и для приоритезации.
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

    // У РО /warehouse/goods/{id} нет фильтра по ID — поиск только по `search`
    // в title/article. При клике на ячейку портал шлёт нормализованный `key`
    // (= title без диакритики), РО его и ищет.
    const filter: { q?: string; title?: string } = {};
    if (body.title) filter.title = body.title;
    else if (body.key) filter.q = body.key;

    type WhResult = {
      warehouseId: number;
      warehouseTitle: string;
      quantity: number;
      match: RoStockItem | null;
    };

    /** Один склад: ищет товар и возвращает количество (0, если не нашли). */
    const probeWarehouse = async (w: {
      id: number;
      title: string;
    }): Promise<WhResult> => {
      const items = await getStock(w.id, filter);
      const match =
        items.find((it) => {
          if (body.roId) return (it.product_id ?? it.id) === body.roId;
          if (body.key)
            return (
              normalizeName(it.product_title ?? it.title ?? "") === body.key
            );
          if (body.title) return (it.product_title ?? it.title) === body.title;
          return false;
        }) ?? items[0];
      const qty = match
        ? Number(match.residue ?? match.quantity ?? match.amount ?? 0)
        : 0;
      return {
        warehouseId: w.id,
        warehouseTitle: w.title,
        quantity: qty,
        match: match ?? null,
      };
    };

    // Параллельные запросы порциями по 5 — даёт ~3х ускорение по сравнению
    // с последовательным обходом, но не упирается в rate limit РО (≈3 req/sec).
    const CHUNK = 5;
    const results: WhResult[] = [];
    for (let i = 0; i < warehouses.length; i += CHUNK) {
      const chunk = warehouses.slice(i, i + CHUNK);
      const chunkResults = await Promise.all(chunk.map(probeWarehouse));
      results.push(...chunkResults);
    }

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
