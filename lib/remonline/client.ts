import "server-only";

/**
 * Серверный клиент Remonline API v1.
 * Авторизация двухступенчатая:
 *   1) POST /token/new c api_key -> получаем session token на ~24 часа
 *   2) Все эндпоинты дёргаем с ?token=<session>
 *
 * Документация: https://roapp.readme.io/reference
 */

const BASE_URL = "https://api.remonline.app";

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

function apiKey(): string {
  const key = process.env.REMONLINE_API_TOKEN;
  if (!key) {
    throw new Error(
      "REMONLINE_API_TOKEN не найден. Добавьте API-ключ в Vercel → Settings → Environment Variables.",
    );
  }
  return key;
}

/** Получить session token (с кэшем в памяти процесса) */
async function getSessionToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }
  const res = await fetch(`${BASE_URL}/token/new`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: apiKey() }).toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Не удалось получить session token у Remonline (HTTP ${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { token?: string; data?: { token?: string } };
  const token = json.token ?? json.data?.token;
  if (!token) {
    throw new Error(
      `Ответ Remonline не содержит token. Тело: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  // Сессия валидна 24 часа — кэшируем на 23.
  cached = { token, expiresAt: Date.now() + 23 * 3600 * 1000 };
  return token;
}

/** Низкоуровневый GET с автоподстановкой токена */
async function apiGet<T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const token = await getSessionToken();
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Remonline GET ${path} вернул HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

/** Низкоуровневый POST с form-encoded body. РО v1 использует form, не JSON. */
async function apiPostForm<T>(
  path: string,
  body: Record<string, string | number | null | undefined>,
): Promise<T> {
  const token = await getSessionToken();
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("token", token);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    form.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Remonline POST ${path} вернул HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

// ── Доменные типы ──────────────────────────────────────────────────────

export type RoWarehouse = {
  id: number;
  title: string;
};

export type RoProduct = {
  id: number;
  title: string;
  article?: string | null;
  /** Закупочная стоимость */
  price?: number | null;
  /** Розничная цена (или массив prices разных типов) */
  custom_price?: number | null;
  prices?: Array<{ id: number; title: string; price: number }>;
  /** Остаток на складе */
  residue?: number | null;
};

export type RoService = {
  id: number;
  title: string;
  /** Цена по умолчанию */
  price?: number | null;
  prices?: Array<{ id: number; title: string; price: number }>;
  /** Длительность в минутах */
  duration?: number | null;
  category?: { id: number; title: string } | null;
};

// ── Публичные методы ───────────────────────────────────────────────────

/** Список складов — для проверки подключения и выбора нужного */
export async function listWarehouses(): Promise<RoWarehouse[]> {
  const json = await apiGet<{ data: RoWarehouse[] }>("/warehouse/warehouses/");
  return json.data ?? [];
}

/** Постраничная выгрузка товаров. Берёт максимум 50 на страницу. */
export async function listProducts(
  warehouseId: number,
  opts: { page?: number; search?: string } = {},
): Promise<{ items: RoProduct[]; page: number; count: number }> {
  const json = await apiGet<{
    data: RoProduct[];
    count: number;
    page: number;
  }>(`/warehouse/goods/${warehouseId}/`, {
    page: opts.page ?? 1,
    search: opts.search,
  });
  return { items: json.data ?? [], page: json.page ?? 1, count: json.count ?? 0 };
}

/** Постраничная выгрузка услуг */
export async function listServices(opts: {
  page?: number;
} = {}): Promise<{ items: RoService[]; page: number; count: number }> {
  const json = await apiGet<{
    data: RoService[];
    count: number;
    page: number;
  }>("/services/", { page: opts.page ?? 1 });
  return { items: json.data ?? [], page: json.page ?? 1, count: json.count ?? 0 };
}

/**
 * Полная выгрузка с автоматической пагинацией.
 * Останавливается, когда страница вернула меньше элементов, чем лимит.
 */
export async function fetchAllProducts(warehouseId: number): Promise<RoProduct[]> {
  const out: RoProduct[] = [];
  for (let page = 1; page <= 200; page++) {
    const { items } = await listProducts(warehouseId, { page });
    if (items.length === 0) break;
    out.push(...items);
    if (items.length < 50) break;
  }
  return out;
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

// ── Запись (одиночные апдейты) ─────────────────────────────────────────

/** Обновить услугу. Передаём только те поля, что хотим поменять. */
export async function updateService(
  id: number,
  patch: { price?: number; duration?: number; title?: string },
): Promise<{ ok: true }> {
  await apiPostForm(`/services/${id}/`, patch);
  return { ok: true };
}

/** Обновить товар. Используется для розничной/закупочной цены. */
export async function updateProduct(
  id: number,
  patch: { price?: number; custom_price?: number; title?: string },
): Promise<{ ok: true }> {
  await apiPostForm(`/warehouse/goods/${id}/`, patch);
  return { ok: true };
}
