import "server-only";

/**
 * Клиент Remonline Public API v2.
 *
 * Документация: https://roapp.readme.io/reference (версия 2.0).
 * База: https://api.roapp.io/v2 + Bearer-токен в заголовке Authorization.
 *
 * Этот клиент только на чтение — портал не пишет ничего в Remonline.
 * Если когда-то понадобится запись (PUT/POST/PATCH), добавим методы тут
 * с явным комментарием: «портал записывает в РО».
 */

const BASE_URL = "https://api.roapp.io";

function getApiToken(): string {
  const t = process.env.REMONLINE_API_TOKEN;
  if (!t || !t.trim()) {
    throw new Error(
      "REMONLINE_API_TOKEN не задан. Настройки → Переменные окружения.",
    );
  }
  return t.trim();
}

/**
 * Универсальный GET с Bearer-авторизацией. Все эндпоинты v2 защищены одинаково.
 * При не-OK отдаём текст ответа в ошибке: 404 неверный путь, 401 битый токен,
 * 429 rate limit (Remonline разрешает 3 запроса в секунду).
 */
async function apiGet<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  arrays: Record<string, Array<string | number>> = {},
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }
  // Массивы передаём как ?ids[]=1&ids[]=2 — Remonline ждёт именно такой формат.
  for (const [k, arr] of Object.entries(arrays)) {
    for (const v of arr) url.searchParams.append(`${k}[]`, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Remonline GET ${path} вернул HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

// ── Доменные типы (минимум полей, что нужны порталу) ───────────────────

export type RoWarehouse = {
  id: number;
  title: string;
  location_id?: number;
};

export type RoService = {
  id: number;
  title: string;
  price?: number | null;
  duration?: number | null;
  code?: string | null;
};

export type RoProduct = {
  id: number;
  title: string;
  article?: string | null;
  barcode?: string | null;
  price?: number | null;
  cost?: number | null;
  category_id?: number | null;
};

export type RoStockItem = {
  product_id?: number;
  id?: number;
  product_title?: string;
  title?: string;
  warehouse_id?: number;
  /**
   * Остаток. v2 в разных эндпоинтах называет это поле по-разному
   * (residue / quantity / amount), читаем все варианты в роуте остатков.
   */
  residue?: number;
  quantity?: number;
  amount?: number;
};

/** Ответ-обёртка v2 — обычно `{ data: [...], page, count }`, но иногда плоский массив. */
type V2List<T> =
  | {
      data?: T[];
      page?: number;
      count?: number;
    }
  | T[];

function unwrapList<T>(json: V2List<T>): {
  items: T[];
  page: number;
  count: number;
} {
  if (Array.isArray(json)) {
    return { items: json, page: 1, count: json.length };
  }
  return {
    items: json.data ?? [],
    page: json.page ?? 1,
    count: json.count ?? json.data?.length ?? 0,
  };
}

// ── Чтение ─────────────────────────────────────────────────────────────

/** Список складов. v2: GET /v2/warehouse/ */
export async function listWarehouses(): Promise<RoWarehouse[]> {
  const json = await apiGet<V2List<RoWarehouse>>("/v2/warehouse/");
  return unwrapList(json).items;
}

/** Постраничный список услуг. v2: GET /v2/services */
export async function listServices(
  opts: { page?: number; q?: string } = {},
): Promise<{ items: RoService[]; page: number; count: number }> {
  const json = await apiGet<V2List<RoService>>("/v2/services", {
    page: opts.page,
    q: opts.q,
  });
  return unwrapList(json);
}

export async function fetchAllServices(): Promise<RoService[]> {
  const out: RoService[] = [];
  for (let page = 1; page <= 200; page++) {
    const { items } = await listServices({ page });
    if (items.length === 0) break;
    out.push(...items);
    if (items.length < 50) break;
  }
  return out;
}

/** Постраничный список товаров. v2: GET /v2/products */
export async function listProducts(
  opts: { page?: number; q?: string; title?: string } = {},
): Promise<{ items: RoProduct[]; page: number; count: number }> {
  const json = await apiGet<V2List<RoProduct>>("/v2/products", {
    page: opts.page,
    q: opts.q,
    title: opts.title,
  });
  return unwrapList(json);
}

export async function fetchAllProducts(): Promise<RoProduct[]> {
  const out: RoProduct[] = [];
  for (let page = 1; page <= 400; page++) {
    const { items } = await listProducts({ page });
    if (items.length === 0) break;
    out.push(...items);
    if (items.length < 50) break;
  }
  return out;
}

/**
 * Остатки по складу. v2: GET /v2/stock?warehouse_id=N&...
 * Можно фильтровать по `title` (точное совпадение), `q` (текст),
 * `articles[]`, `barcodes[]`, `ids[]`. Нам обычно нужно `q` или `title`.
 *
 * Возвращает массив RoStockItem; каждый элемент — это запись об остатке
 * конкретного товара на этом складе.
 */
export async function getStock(
  warehouseId: number,
  filter: { title?: string; q?: string; ids?: number[] } = {},
): Promise<RoStockItem[]> {
  const json = await apiGet<V2List<RoStockItem>>(
    "/v2/stock",
    {
      warehouse_id: warehouseId,
      title: filter.title,
      q: filter.q,
      exclude_zero_residue: false,
    },
    filter.ids?.length ? { ids: filter.ids } : {},
  );
  return unwrapList(json).items;
}
