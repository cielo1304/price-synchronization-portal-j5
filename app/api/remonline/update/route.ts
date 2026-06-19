import { NextResponse } from "next/server";
import {
  updateProductPrice,
  updateServicePrice,
  getStock,
  listWarehouses,
  getProductById,
  fetchAllServices,
} from "@/lib/remonline/client";
import { normalizeName } from "@/lib/remonline/normalize";


export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * PATCH /api/remonline/update
 *
 * Синхронизирует одно значение из портала в Remonline.
 * Тело запроса:
 * {
 *   kind: "part-purchase" | "part-retail" | "service-price",
 *   key: string,         // нормализованный ключ (для матчинга в snapshot)
 *   value: number,       // новое значение из портала
 *   // идентификаторы запчасти (для part-*)
 *   partProductId?: string | null,
 *   partCode?: string | null,
 *   partArticle?: string | null,
 *   partBarcode?: string | null,
 * }
 *
 * Стратегия:
 * - Для услуги: ищем по нормализованному имени в /services/, берём id,
 *   шлём PUT /services/{id} с price.
 * - Для запчасти: ищем по product_id / barcode через /products/ или /warehouse/goods/,
 *   берём id, шлём PUT /products/{id} с cost (закупка) или price (розница).
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const {
      kind,
      key,
      value,
      partProductId,
      partCode,
      partBarcode,
    } = body as {
      kind: "part-purchase" | "part-retail" | "service-price";
      key: string;
      value: number;
      partProductId?: string | null;
      partCode?: string | null;
      partArticle?: string | null;
      partBarcode?: string | null;
    };

    if (!kind || !key || value === undefined || value === null) {
      return NextResponse.json(
        { ok: false, error: "Недостаточно параметров: kind, key, value обязательны" },
        { status: 400 },
      );
    }

    // ── Услуга ──────────────────────────────────────────────────────────
    if (kind === "service-price") {
      const services = await fetchAllServices();
      const match = services.find((s) => normalizeName(s.title ?? "") === key);
      if (!match) {
        return NextResponse.json(
          { ok: false, error: `Услуга с ключом «${key}» не найдена в Remonline` },
          { status: 404 },
        );
      }
      await updateServicePrice(match.id, { price: value });
      return NextResponse.json({
        ok: true,
        updated: { id: match.id, title: match.title, newPrice: value },
      });
    }

    // ── Запчасть ─────────────────────────────────────────────────────────
    // Ищем product_id: сначала через idшник/код, потом через штрихкод,
    // потом через snapshot продуктов по нормализованному имени.
    const cleanId = (v?: string | null) =>
      v ? String(v).replace(/\s+/g, "").trim() : null;

    let roProductId: number | string | null = null;

    // 1. Прямой запрос по product_id или коду
    const tryId = cleanId(partProductId) ?? cleanId(partCode);
    if (tryId) {
      const card = await getProductById(tryId).catch(() => null);
      if (card?.id) roProductId = card.id;
    }

    // 2. Через остатки по штрихкоду
    if (!roProductId && cleanId(partBarcode)) {
      const warehouses = await listWarehouses();
      for (const wh of warehouses.slice(0, 3)) {
        const items = await getStock(wh.id, {
          barcodes: [cleanId(partBarcode)!],
        });
        const found = items[0];
        if (found) {
          roProductId = found.product_id ?? found.id ?? null;
          if (roProductId) break;
        }
      }
    }

    if (!roProductId) {
      return NextResponse.json(
        { ok: false, error: `Товар с ключом «${key}» не найден в Remonline` },
        { status: 404 },
      );
    }

    // PUT /products/{id}
    // РО: cost = закупочная, price = розничная
    const patch =
      kind === "part-purchase"
        ? { cost: value }
        : { price: value };

    await updateProductPrice(roProductId, patch);

    return NextResponse.json({
      ok: true,
      updated: { id: roProductId, kind, newValue: value },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
