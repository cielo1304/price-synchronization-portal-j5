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
 * У запчасти в исходной таблице может быть до четырёх идентификаторов
 * (ID / Код / Артикул / Штрихкод). РО `?search=` индексирует одновременно
 * `title + article + code + barcode`, поэтому мы по очереди пробуем
 * каждый непустой идентификатор: на первом, который вернул ровно один
 * товар с точным совпадением хотя бы одного из его собственных полей —
 * останавливаемся, обходим параллельно все 16 складов и считаем сумму
 * остатков.
 *
 * Порядок проб: штрихкод → артикул → код → ID. Самые «уникальные»
 * идентификаторы идут первыми, чтобы минимизировать риск, что под
 * `?search=` попадёт несколько разных товаров (например по короткому
 * коду «175» уехал бы куст совпадений).
 *
 * Никакого snapshot товаров и никакого `GET /products/{id}`: с `?search=`
 * мы получаем сразу и сам товар, и его реальный article/code/barcode,
 * поэтому матч строим из того же ответа.
 */

type StripField = "article" | "code" | "barcode" | "title";

const stripSpaces = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const safeStr = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
};

type RoStockItemEx = RoStockItem & {
  article?: string | null;
  code?: string | null;
  barcode?: string | null;
  barcodes?: Array<string | { code?: string }> | null;
};

/** Все «отпечатки» товара для сравнения с искомым ID — нормализованные. */
const productFingerprints = (it: RoStockItemEx): Set<string> => {
  const out = new Set<string>();
  const push = (v: unknown) => {
    const s = stripSpaces(safeStr(v));
    if (s) out.add(s);
  };
  push(it.article);
  push(it.code);
  push(it.barcode);
  if (Array.isArray(it.barcodes)) {
    for (const b of it.barcodes) {
      if (typeof b === "string") push(b);
      else if (b && typeof b === "object") push(b.code);
    }
  }
  return out;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      key?: string;
      partArticle?: string | null;
      partBarcode?: string | null;
      partCode?: string | null;
      partProductId?: string | null;
      // Старая совместимость
      roArticle?: string | null;
      warehouseId?: number;
    };

    const clean = (v?: string | null) => {
      if (!v) return "";
      return v.replace(/\s+/g, "").trim();
    };

    // Пробы в порядке убывания «уникальности».
    type Probe = { kind: StripField | "productId"; value: string };
    const probesRaw: Probe[] = [
      { kind: "barcode", value: clean(body.partBarcode) },
      {
        kind: "article",
        value: clean(body.partArticle ?? body.roArticle),
      },
      { kind: "code", value: clean(body.partCode) },
      { kind: "productId", value: clean(body.partProductId) },
    ];
    // Уникализируем (часто Код == ID).
    const seen = new Set<string>();
    const probes = probesRaw.filter((p) => {
      if (!p.value) return false;
      if (seen.has(p.value)) return false;
      seen.add(p.value);
      return true;
    });

    if (probes.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "У запчасти не заполнен ни один идентификатор (ID, Код, Артикул, Штрихкод). Заполните хотя бы одно поле в исходной таблице.",
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

    // «Сервис» и «Б/У» — основные склады, опрашиваем первыми (всё равно
    // обходим все 16, но так первая ненулевая позиция найдётся быстрее).
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
      match: RoStockItemEx | null;
    };

    /**
     * Один обход всех складов с подобранным под тип идентификатора
     * фильтром. РО `?search=` ищет по title+article (по подстроке) и
     * НЕ ищет по полю «Код» и штрихкоду — поэтому для них нужны узкие
     * фильтры (`?code=`, `?barcode=`). Если РО их игнорирует, ответом
     * придут просто первые 50 товаров — fingerprint-матч их всё равно
     * правильно отфильтрует.
     */
    const sweep = async (
      probeKind: Probe["kind"],
      value: string,
      probeValueNorm: string,
    ): Promise<{ found: WhResult[]; total: number }> => {
      // Под каждый kind — свой набор фильтров. Для productId/article
      // используем `?search=` (это и есть «по артикулу/title»),
      // для кода и штрихкода — узкие точные фильтры.
      const filterFor = (): Parameters<typeof getStock>[1] => {
        switch (probeKind) {
          case "barcode":
            return { barcode: value, search: value };
          case "code":
            return { code: value, search: value };
          case "article":
            return { article: value, search: value };
          case "productId":
          default:
            return { search: value };
        }
      };
      const filter = filterFor();
      const results = await Promise.all(
        warehouses.map(async (w): Promise<WhResult> => {
          const items = (await getStock(w.id, filter)) as RoStockItemEx[];
          // Точный матч: ищем товар, у которого ХОТЯ БЫ ОДИН из его
          // собственных идентификаторов точно совпадает с тем, что мы
          // искали — без частичных совпадений по title.
          const match =
            items.find((it) =>
              productFingerprints(it).has(probeValueNorm),
            ) ?? null;
          const qty = match
            ? Number(match.residue ?? match.quantity ?? match.amount ?? 0)
            : 0;
          return {
            warehouseId: w.id,
            warehouseTitle: w.title,
            quantity: qty,
            match,
          };
        }),
      );
      const found = results.filter((r) => r.match);
      const total = found.reduce((s, r) => s + r.quantity, 0);
      return { found, total };
    };

    // Лог попыток, который вернём клиенту, чтобы было видно глазами,
    // какой идентификатор реально нашёл товар (или почему не нашёл).
    const tried: Array<{
      kind: Probe["kind"];
      value: string;
      hits: number;
    }> = [];

    let chosen: { probe: Probe; result: Awaited<ReturnType<typeof sweep>> } | null = null;

    for (const p of probes) {
      const norm = stripSpaces(p.value);
      const r = await sweep(p.kind, p.value, norm);
      tried.push({ kind: p.kind, value: p.value, hits: r.found.length });
      if (r.found.length > 0) {
        chosen = { probe: p, result: r };
        break;
      }
    }

    if (!chosen) {
      return NextResponse.json({
        ok: true,
        found: false,
        tried,
        fetchedAt: new Date().toISOString(),
      });
    }

    const { probe, result } = chosen;
    const firstMatch = result.found[0]!.match!;

    return NextResponse.json({
      ok: true,
      found: true,
      product: {
        id: firstMatch.product_id ?? firstMatch.id ?? null,
        title: firstMatch.product_title ?? firstMatch.title ?? "",
        article: firstMatch.article ?? null,
        code: firstMatch.code ?? null,
        barcode: firstMatch.barcode ?? null,
      },
      matchedBy: { kind: probe.kind, value: probe.value },
      quantity: result.total,
      perWarehouse: result.found.map((r) => ({
        warehouseId: r.warehouseId,
        warehouseTitle: r.warehouseTitle,
        quantity: r.quantity,
      })),
      tried,
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
