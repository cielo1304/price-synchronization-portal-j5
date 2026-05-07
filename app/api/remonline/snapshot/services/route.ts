import { NextResponse } from "next/server";
import { fetchAllServices } from "@/lib/remonline/client";
import { normalizeName, priceOf } from "@/lib/remonline/normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Snapshot всех услуг Remonline для матчинга по нормализованному имени.
 * Возвращает Record<key, RoServiceMatch>. Ничего не пишет.
 */
export async function GET() {
  try {
    const services = await fetchAllServices();
    const items: Record<
      string,
      {
        id: number;
        title: string;
        price: number | null;
        duration: number | null;
      }
    > = {};
    for (const s of services) {
      const key = normalizeName(s.title);
      if (!items[key]) {
        items[key] = {
          id: s.id,
          title: s.title,
          price: priceOf(s),
          duration: s.duration ?? null,
        };
      }
    }
    return NextResponse.json({
      ok: true,
      total: services.length,
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
