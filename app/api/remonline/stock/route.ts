import { NextResponse } from "next/server";
import {
  listWarehouses,
  fetchAllProducts,
  type RoProduct,
} from "@/lib/remonline/client";
import { normalizeName } from "@/lib/remonline/normalize";

export const runtime = "nodejs";

/**
 * Запрос остатка по одной запчасти в реальном времени.
 *
 * Принимает либо `roId` (если у нас есть точная привязка), либо `key`
 * (нормализованное имя). Возвращает количество и время запроса.
 *
 * Если склад не указан — обходит все склады и суммирует остатки.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      roId?: number;
      key?: string;
      warehouseId?: number;
    };

    if (!body.roId && !body.key) {
      return NextResponse.json(
        { ok: false, error: "Нужно указать roId или key" },
        { status: 400 },
      );
    }

    const warehouseIds = body.warehouseId
      ? [body.warehouseId]
      : (await listWarehouses()).map((w) => w.id);

    // Собираем остатки со всех складов: складские остатки могут быть размазаны
    // по нескольким локациям, и менеджер хочет видеть итог.
    let totalQty = 0;
    let foundProduct: RoProduct | null = null;
    const perWarehouse: Array<{
      warehouseId: number;
      quantity: number;
    }> = [];

    for (const wid of warehouseIds) {
      const all = await fetchAllProducts(wid);
      const match = all.find((p) => {
        if (body.roId && p.id === body.roId) return true;
        if (body.key && normalizeName(p.title) === body.key) return true;
        return false;
      });
      if (match) {
        const qty = Number(match.residue ?? 0);
        totalQty += qty;
        perWarehouse.push({ warehouseId: wid, quantity: qty });
        foundProduct = match;
      }
    }

    if (!foundProduct) {
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
        id: foundProduct.id,
        title: foundProduct.title,
        article: foundProduct.article ?? null,
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
