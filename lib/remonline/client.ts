import "server-only";

/**
 * Клиент Remonline Public API.
 *
 * Документация: https://roapp.readme.io/reference (RemOnline Public API).
 * База: https://api.remonline.app + Bearer-токен (api-key прямо в Authorization).
 *
 * Никакого обмена api-key на session-token не нужно — это был старый-старый
 * флоу 2018-2020 годов через POST /token/new. Сейчас api-key, выданный в
 * настройках РО, используется напрямую: `Authorization: Bearer <api_key>`.
 *
 * Это подтверждается официальными Python/PHP/Node примерами в документации
 * каждого эндпоинта (см. напр. /tasks или /warehouse/postings/).
 */

const BASE_URL = "https://api.remonline.app";

/** Таймаут одного HTTP-запроса. РО иногда долго отвечает на /products. */
const REQUEST_TIMEOUT_MS = 30_000;

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
  // AbortController нужен явно — у Node fetch нет встроенного timeout.
  // Без него зависший запрос РО будет держать handler до серверного лимита (≈60 сек).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${getApiToken()}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Remonline GET ${path} вернул HTTP ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(
        `Remonline GET ${path}: таймаут ${REQUEST_TIMEOUT_MS / 1000} сек. Попробуйте позже.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
  /** Артикул товара. РО индексирует его в `?search=` и отдаёт в ответе. */
  article?: string | null;
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

/** Список складов. GET /warehouse/ */
export async function listWarehouses(): Promise<RoWarehouse[]> {
  const json = await apiGet<V2List<RoWarehouse>>("/warehouse/");
  return unwrapList(json).items;
}

/** Постраничный список услуг. GET /services/ */
export async function listServices(
  opts: { page?: number; q?: string } = {},
): Promise<{ items: RoService[]; page: number; count: number }> {
  const json = await apiGet<V2List<RoService>>("/services/", {
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

/**
 * Постраничный список товаров склада. GET /warehouse/goods/{warehouse_id}
 *
 * ВАЖНО: путь должен быть БЕЗ trailing slash. У роутера РО на этом эндпоинте
 * `/warehouse/goods/{id}/` (со слешем) возвращает 404, а `/warehouse/goods/{id}`
 * (без слеша) — 200. Это отличается от `/warehouse/`, где слеш обязателен.
 * Подтверждено диагностическим прогоном.
 */
export async function listProducts(
  warehouseId: number,
  opts: { page?: number; search?: string } = {},
): Promise<{ items: RoProduct[]; page: number; count: number }> {
  const json = await apiGet<V2List<RoProduct>>(
    `/warehouse/goods/${warehouseId}`,
    {
      page: opts.page,
      search: opts.search,
    },
  );
  return unwrapList(json);
}

/**
 * Тянет все товары конкретного склада по страницам. РО возвращает 50 на страницу.
 * 400 — защитный потолок (при 50 на стр. это 20 000 позиций, реальные
 * каталоги обычно 1000-3000).
 */
export async function fetchAllProducts(
  warehouseId: number,
): Promise<RoProduct[]> {
  const out: RoProduct[] = [];
  for (let page = 1; page <= 400; page++) {
    const { items } = await listProducts(warehouseId, { page });
    if (items.length === 0) break;
    out.push(...items);
    if (items.length < 50) break;
  }
  return out;
}

/**
 * Остатки по складу. GET /warehouse/goods/{warehouse_id}?search=<title>
 *
 * У РО нет отдельного `/stock` — остаток лежит в самом объекте товара
 * (поле `residue`). Параметр `search` ищет по подстроке title/article.
 *
 * Тянем ОДНУ страницу (50 элементов). Если РО понимает search —
 * страница маленькая и ответ быстрый. Если не понимает и возвращает
 * первые 50 товаров склада — этого достаточно: точное совпадение
 * мы потом отфильтруем локально по нормализованному имени.
 * 10 страниц как было раньше — это 8 секунд × 16 складов = таймаут.
 */
export async function getStock(
  warehouseId: number,
  filter: { title?: string; q?: string } = {},
): Promise<RoStockItem[]> {
  const search = filter.title ?? filter.q;
  const json = await apiGet<V2List<RoStockItem>>(
    `/warehouse/goods/${warehouseId}`,
    { page: 1, search },
  );
  return unwrapList(json).items;
}
