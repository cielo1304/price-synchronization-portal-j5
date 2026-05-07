import { NextResponse } from "next/server";
import { listWarehouses, listServices, listProducts } from "@/lib/remonline/client";

export const dynamic = "force-dynamic";

/**
 * Проверка подключения к Remonline.
 * Дёргает 3 безопасных GET-эндпоинта и собирает сводку.
 * Никаких записей не делает.
 */
export async function GET() {
  const summary: {
    ok: boolean;
    error?: string;
    warehouses?: Array<{ id: number; title: string }>;
    servicesCount?: number;
    productsSample?: Array<{ id: number; title: string; article?: string | null }>;
  } = { ok: false };

  try {
    const warehouses = await listWarehouses();
    summary.warehouses = warehouses.map((w) => ({ id: w.id, title: w.title }));

    const services = await listServices({ page: 1 });
    summary.servicesCount = services.count;

    if (warehouses[0]) {
      const products = await listProducts(warehouses[0].id, { page: 1 });
      summary.productsSample = products.items.slice(0, 5).map((p) => ({
        id: p.id,
        title: p.title,
        article: p.article,
      }));
    }

    summary.ok = true;
  } catch (err) {
    summary.ok = false;
    summary.error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(summary);
}
