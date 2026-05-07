import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Диагностика подключения к Remonline.
 *
 * Шаг 1. Меняем долгоживущий API-key на short-lived session-token через
 * POST /token/new?api_key=…  Это типичная схема Remonline v1.
 *
 * Шаг 2. С полученным session-token бьём по разным комбинациям домена и
 * пути для списка складов. Какой именно ответит 200 — увидим в отчёте,
 * под него и переключим основной клиент.
 */
export async function GET() {
  const apiKey = (process.env.REMONLINE_API_TOKEN ?? "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "REMONLINE_API_TOKEN не задан" },
      { status: 500 },
    );
  }

  const results: Array<{
    url: string;
    auth: "bearer" | "query-token" | "none";
    status: number;
    ok: boolean;
    bodyPreview: string;
  }> = [];

  /** Один проб с автотаймаутом 15 секунд. */
  async function probe(opts: {
    url: string;
    auth: "bearer" | "query-token" | "none";
    method?: "GET" | "POST";
    bearerToken?: string;
  }) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (opts.auth === "bearer" && opts.bearerToken) {
        headers.Authorization = `Bearer ${opts.bearerToken}`;
      }
      const res = await fetch(opts.url, {
        method: opts.method ?? "GET",
        headers,
        cache: "no-store",
        signal: ctrl.signal,
      });
      const text = await res.text().catch(() => "");
      results.push({
        url: opts.url,
        auth: opts.auth,
        status: res.status,
        ok: res.ok,
        bodyPreview: text.slice(0, 220),
      });
      return { status: res.status, body: text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        url: opts.url,
        auth: opts.auth,
        status: 0,
        ok: false,
        bodyPreview: `network/abort: ${msg.slice(0, 200)}`,
      });
      return { status: 0, body: "" };
    } finally {
      clearTimeout(t);
    }
  }

  // 1. Карты API — для понимания того, какие пути живут на сервере.
  await probe({ url: "https://api.roapp.io/", auth: "none" });

  // 2. Получаем session-token. Это критично: без него ни один защищённый
  //    эндпоинт v1 не ответит 200.
  const tokenRes = await probe({
    url: `https://api.remonline.app/token/new?api_key=${encodeURIComponent(apiKey)}`,
    auth: "none",
    method: "POST",
  });

  let sessionToken: string | null = null;
  try {
    const json = JSON.parse(tokenRes.body);
    if (json && typeof json.token === "string") sessionToken = json.token;
  } catch {
    /* not json */
  }

  // 3. Проверяем тот же /token/new на api.roapp.io — раньше я уже видел,
  //    что v1 эндпоинты дублируются и на этом домене.
  if (!sessionToken) {
    const altRes = await probe({
      url: `https://api.roapp.io/api/token/new?api_key=${encodeURIComponent(apiKey)}`,
      auth: "none",
      method: "POST",
    });
    try {
      const json = JSON.parse(altRes.body);
      if (json && typeof json.token === "string") sessionToken = json.token;
    } catch {
      /* not json */
    }
  }

  // 4. С полученным session-token пробиваем сначала ЗАВЕДОМО ЖИВОЙ эндпоинт
  //    (`/api/bookings`, который явно указан в карте API). Если он ответит
  //    200 — значит правильная база `https://api.roapp.io/api`, и мы сможем
  //    дальше угадать пути для warehouse/goods. Если же 401/403 — значит
  //    session-token не годится для этого формата API, и причина в этом.
  if (sessionToken) {
    const tk = encodeURIComponent(sessionToken);
    const candidates = [
      // Карта API явно подсказала — bookings живёт здесь:
      `https://api.roapp.io/api/bookings?token=${tk}`,
      `https://api.roapp.io/api/bookings/?token=${tk}`,

      // Пары для складов на той же базе /api:
      `https://api.roapp.io/api/warehouses?token=${tk}`,
      `https://api.roapp.io/api/warehouses/?token=${tk}`,
      `https://api.roapp.io/api/warehouse/warehouses?token=${tk}`,

      // Товары — два известных шаблона v1:
      `https://api.roapp.io/api/warehouse/goods?token=${tk}`,
      `https://api.roapp.io/api/products?token=${tk}`,

      // На случай, если api.remonline.app разрешает другой префикс:
      `https://api.remonline.app/api/bookings?token=${tk}`,
    ];
    for (const url of candidates) {
      await probe({ url, auth: "query-token" });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      tokenLength: apiKey.length,
      tokenPreview: `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`,
      sessionToken: sessionToken
        ? `${sessionToken.slice(0, 4)}…${sessionToken.slice(-4)}`
        : null,
      results,
    },
    { status: 200 },
  );
}
