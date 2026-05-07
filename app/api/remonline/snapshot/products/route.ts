import { NextResponse } from "next/server";
import { fetchAllProducts } from "@/lib/remonline/client";
import { normalizeName, priceOf } from "@/lib/remonline/normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Snapshot всех товаров Remonline для матчинга по нормализованному имени.
 * Возвращает Record<key, { id, title, article, retail }>.
 *
 * Остатки тут не возвращаем — они запрашиваются точечно через /api/remonline/stock,
 * чтобы данные были live и не приходилось тянуть огромный список со всех складов.
 */
export async function GET() {
  try {
    const products = await fetchAllProducts();
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
