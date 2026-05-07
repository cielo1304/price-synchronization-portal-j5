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

    // search в РО — это поиск по подстроке title/article (регистронезависимо).
    // Передавать ВЕСЬ нормализованный key опасно: он содержит латинизи-
    // рованные слова типа "displei servisnyj", которых нет в реальных
    // названиях ("Дисплей - сервисный"). Поэтому передаём только первые
    // 1-2 слова (обычно "iphone 16", "samsung s23") — этого хватает,
    // чтобы РО вернул нужный поднабор.
    const buildSearch = (key?: string, title?: string): string | undefined => {
      const src = title ?? key;
      if (!src) return undefined;
      const words = src.split(/\s+/).filter(Boolean);
      if (words.length === 0) return undefined;
      const first = words[0];
      // Если первое слово начинается с цифры (например "010a13") —
      // выборка получится мусорная, лучше тянуть всё и матчить локально.
      if (/^\d/.test(first)) return undefined;
      return words.slice(0, 2).join(" ");
    };
    const searchValue = buildSearch(body.key, body.title);
    const filter: { q?: string } = searchValue ? { q: searchValue } : {};

    // Слова ключа, которые ВСЕ должны встретиться в нормализованном title.
    const keyWords = body.key ? body.key.split(/\s+/).filter(Boolean) : [];

    type WhResult = {
      warehouseId: number;
      warehouseTitle: string;
      quantity: number;
      match: RoStockItem | null;
    };

    /**
     * Один склад: ищет лучшее совпадение и возвращает количество.
     *
     * Логика матчинга:
     *  1. roId → точное равенство по id (идеальный случай).
     *  2. key  → собираем кандидатов, у которых ВСЕ слова key встречаются
     *           в нормализованном title (как подстроки). Из кандидатов
     *           выбираем с самым коротким нормализованным title — он
     *           самый «чистый», без лишних слов вроде «(копия)» или
     *           «с мелким дефектом».
     *  3. title → точное равенство по сырому title.
     *
     * Никакого fallback на items[0] — лучше показать «Не найдено», чем
     * случайный товар склада как найденный.
     */
    const probeWarehouse = async (w: {
      id: number;
      title: string;
    }): Promise<WhResult> => {
      const items = await getStock(w.id, filter);
      let match: RoStockItem | null = null;

      if (body.roId) {
        match =
          items.find((it) => (it.product_id ?? it.id) === body.roId) ?? null;
      } else if (keyWords.length > 0) {
        type Cand = { item: RoStockItem; normLen: number };
        const candidates: Cand[] = [];
        for (const it of items) {
          const norm = normalizeName(it.product_title ?? it.title ?? "");
          if (keyWords.every((kw) => norm.includes(kw))) {
            candidates.push({ item: it, normLen: norm.length });
          }
        }
        if (candidates.length > 0) {
          candidates.sort((a, b) => a.normLen - b.normLen);
          match = candidates[0].item;
        }
      } else if (body.title) {
        match =
          items.find((it) => (it.product_title ?? it.title) === body.title) ??
          null;
      }

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

    // Все склады параллельно: 16 запросов × ~500мс ≈ 600мс с учётом
    // конкурентности vs ~10 сек последовательно. РО спокойно держит
    // такой залп — в документации лимит 30 req/min, мы укладываемся.
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
