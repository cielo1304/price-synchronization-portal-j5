import { NextResponse } from "next/server";
import {
  updateProductPrice,
  updateServicePrice,
  findServiceByQuery,
  getMargins,
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
      serviceBarcode,
    } = body as {
      kind: "part-purchase" | "part-retail" | "service-price";
      key: string;
      value: number;
      partProductId?: string | null;
      partCode?: string | null;
      partArticle?: string | null;
      partBarcode?: string | null;
      /**
       * Штрихкод услуги в РО (например "i17-CAMR").
       * Используется для точного поиска через GET /services/?q=
       */
      serviceBarcode?: string | null;
    };

    if (!kind || !key || value === undefined || value === null) {
      return NextResponse.json(
        { ok: false, error: "Недостаточно параметров: kind, key, value обязательны" },
        { status: 400 },
      );
    }

    // ── Услуга ──────────────────────────────────────────────────────────
    if (kind === "service-price") {
      let match: {
        id: number | string;
        title?: string;
        prices?: Record<string, number> | null;
      } | null = null;

      // 1. Точный поиск по штрихкоду через q= (РО ищет по title/code/barcode).
      //    barcodes в ответе РО — массив ОБЪЕКТОВ {id, code, type},
      //    поэтому сравниваем именно по полю code.
      if (serviceBarcode) {
        const needle = String(serviceBarcode).trim().toLowerCase();
        const results = await findServiceByQuery(needle);
        match =
          results.find((s) =>
            (s.barcodes ?? []).some(
              (b) =>
                String(
                  typeof b === "object" && b !== null
                    ? (b as { code?: string }).code
                    : b,
                )
                  .trim()
                  .toLowerCase() === needle,
            ),
          ) ??
          results[0] ??
          null;
      }

      // 2. Фоллбек: полный перебор по нормализованному имени
      if (!match) {
        const services = await fetchAllServices();
        match =
          services.find((s) => normalizeName(String(s.title ?? "")) === key) ??
          null;
      }

      if (!match) {
        return NextResponse.json(
          {
            ok: false,
            error: `Услуга не найдена в Remonline. Ключ: «${key}», штрихкод: «${serviceBarcode ?? "—"}»`,
          },
          { status: 404 },
        );
      }

      // Портал синхронизирует "Стандартную цену" — это тип цены (margin),
      // а не поле cost. Находим его id динамически через GET /margins/.
      const margins = await getMargins();
      const standard =
        margins.find((m) => normalizeName(m.title) === normalizeName("Стандартная цена")) ??
        null;

      if (!standard) {
        return NextResponse.json(
          {
            ok: false,
            error: `В Remonline не найден тип цены «Стандартная цена». Доступны: ${margins.map((m) => m.title).join(", ")}`,
          },
          { status: 404 },
        );
      }

      // PUT /services/{id}. РО заменяет весь объект prices целиком, поэтому
      // берём текущие цены услуги и меняем ТОЛЬКО Стандартную цену — иначе
      // Розничная/Закупочная обнулятся. Себестоимость (cost) НЕ передаём.
      const currentPrices: Record<string, number> = { ...(match.prices ?? {}) };
      currentPrices[String(standard.id)] = value;

      await updateServicePrice(match.id, { prices: currentPrices });
      return NextResponse.json({
        ok: true,
        updated: {
          id: match.id,
          title: match.title,
          priceType: standard.title,
          newPrice: value,
        },
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
