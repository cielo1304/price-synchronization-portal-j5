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
 * По документации Remonline v1.4 (https://roapp.readme.io/v1.4/reference/get-stock)
 * эндпоинт `GET /warehouse/goods/{warehouse_id}` принимает ТОЧНЫЕ фильтры
 * по массивам идентификаторов:
 *   • ids[]={product_id}     — внутренний ID товара в РО
 *   • articles[]={article}   — артикул (SKU)
 *   • barcodes[]={barcode}   — штрихкод
 *
 * Никакого fuzzy-search и никаких fingerprint-эвристик не нужно: если
 * мы знаем хотя бы один точный идентификатор — РО сам вернёт ровно тот
 * товар (или пустой список) с его текущим residue по складу.
 *
 * Алгоритм:
 *   1) Берём первый непустой идентификатор из {productId, barcode, article}
 *      и обходим параллельно все склады с соответствующим точным фильтром.
 *   2) Если по этому идентификатору ничего не нашлось — пробуем следующий.
 *   3) Суммируем `residue` по всем складам, где товар найден.
 *
 * `code` (внутренний «Код» товара в РО) в API v1.4 как фильтр не
 * поддерживается, поэтому отдельно по нему не ходим — он обычно
 * совпадает либо с product_id, либо с артикулом.
 */
type ProbeKind = "productId" | "barcode" | "article";
type Probe = { kind: ProbeKind; value: string };

const clean = (v?: string | null) => (v ? v.replace(/\s+/g, "").trim() : "");

type RoStockItemEx = RoStockItem & {
  product_id?: number;
  id?: number;
};

const readResidue = (it: RoStockItemEx): number =>
  Number(it.residue ?? it.quantity ?? it.amount ?? 0) || 0;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      partArticle?: string | null;
      partBarcode?: string | null;
      partCode?: string | null;
      partProductId?: string | null;
      // старая совместимость
      roArticle?: string | null;
      warehouseId?: number;
    };

    // Порядок проб: ID → штрихкод → артикул. ID самый уникальный, его
    // и пробуем первым. Дубликаты по значению убираем, чтобы не звонить
    // в РО второй раз с тем же фильтром (Код часто == ID).
    const probesRaw: Probe[] = [
      { kind: "productId", value: clean(body.partProductId) },
      { kind: "barcode", value: clean(body.partBarcode) },
      { kind: "article", value: clean(body.partArticle ?? body.roArticle) },
    ];
    const seen = new Set<string>();
    const probes: Probe[] = probesRaw.filter((p) => {
      if (!p.value) return false;
      const k = `${p.kind}:${p.value}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (probes.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "У запчасти не заполнен ни один идентификатор (ID, Артикул, Штрихкод). Заполните хотя бы одно поле в исходной таблице.",
        },
        { status: 400 },
      );
    }

    const warehouses = await listWarehouses();
    if (warehouses.length === 0) {
      return NextResponse.json(
        { ok: false, error: "В Remonline нет ни одного склада" },
        { status: 400 },
      );
    }
    // Если фронт жёстко указал склад — фильтруем (диагностический режим).
    const targetWarehouses = body.warehouseId
      ? warehouses.filter((w) => w.id === body.warehouseId)
      : warehouses;

    type WhResult = {
      warehouseId: number;
      warehouseTitle: string;
      quantity: number;
      match: RoStockItemEx | null;
    };

    /** Обход всех складов одним точным фильтром. */
    const sweep = async (probe: Probe): Promise<WhResult[]> => {
      const filter =
        probe.kind === "productId"
          ? { ids: [probe.value] }
          : probe.kind === "barcode"
            ? { barcodes: [probe.value] }
            : { articles: [probe.value] };

      return Promise.all(
        targetWarehouses.map(async (w): Promise<WhResult> => {
          const items = (await getStock(w.id, filter)) as RoStockItemEx[];
          // Точные фильтры РО уже сами вернули нужный товар. На редкий
          // случай, когда `articles[]=` или `barcodes[]=` отдают
          // несколько вариантов (например один артикул у двух разных
          // SKU — так бывает после миграций), берём ПЕРВЫЙ совпадающий.
          const match = items[0] ?? null;
          return {
            warehouseId: w.id,
            warehouseTitle: w.title,
            quantity: match ? readResidue(match) : 0,
            match,
          };
        }),
      );
    };

    const tried: Array<{
      kind: ProbeKind;
      value: string;
      hits: number;
    }> = [];

    let chosen: { probe: Probe; results: WhResult[] } | null = null;

    for (const p of probes) {
      const results = await sweep(p);
      const found = results.filter((r) => r.match);
      tried.push({ kind: p.kind, value: p.value, hits: found.length });
      if (found.length > 0) {
        chosen = { probe: p, results: found };
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

    const { probe, results } = chosen;
    const totalQty = results.reduce((s, r) => s + r.quantity, 0);
    const firstMatch = results[0]!.match!;

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
      quantity: totalQty,
      perWarehouse: results.map((r) => ({
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
