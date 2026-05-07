import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Диагностика подключения к Remonline.
 *
 * Проходит по нескольким вероятным URL'ам и для каждого фиксирует
 * статус и кусочек ответа — это помогает понять, почему запрос ломается:
 * не тот префикс пути, неправильный тип токена, нет прав, и т.п.
 *
 * Пробуем:
 *   - корневой `/` и `/v2/` без auth — должен вернуть карту API
 *   - три варианта пути списка складов на двух базах
 *
 * Никаких операций записи. Сюда можно нажать кнопку «Диагностика»
 * в SyncPanel и увидеть, что именно отвечает РО для вашего токена.
 */
export async function GET() {
  const token = (process.env.REMONLINE_API_TOKEN ?? "").trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "REMONLINE_API_TOKEN не задан" },
      { status: 500 },
    );
  }

  const probes: Array<{
    url: string;
    auth: "bearer" | "query-token" | "none";
    method?: "GET" | "POST";
  }> = [
    // Карты API — должны отдавать JSON со ссылками без авторизации
    { url: "https://api.roapp.io/", auth: "none" },
    { url: "https://api.roapp.io/v2/", auth: "none" },

    // v2 API на api.roapp.io со списком складов и проч.
    { url: "https://api.roapp.io/v2/warehouse/", auth: "bearer" },
    { url: "https://api.roapp.io/v2/warehouses/", auth: "bearer" },
    { url: "https://api.roapp.io/v2/services/", auth: "bearer" },
    { url: "https://api.roapp.io/v2/products/", auth: "bearer" },

    // v1 API на api.remonline.app (старый, ?token=… в query):
    // если там вернётся 200 — у вас api-key v1, и нужно использовать v1-клиент.
    {
      url: `https://api.remonline.app/token/new?api_key=${encodeURIComponent(token)}`,
      auth: "none",
      method: "POST",
    },
    {
      url: `https://api.remonline.app/warehouse/warehouses/?token=${encodeURIComponent(token)}`,
      auth: "none",
    },
  ];

  const results = [];
  for (const probe of probes) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (probe.auth === "bearer") {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(probe.url, {
        method: probe.method ?? "GET",
        headers,
        cache: "no-store",
        signal: ctrl.signal,
      });
      const text = await res.text().catch(() => "");
      results.push({
        url: probe.url,
        auth: probe.auth,
        status: res.status,
        ok: res.ok,
        bodyPreview: text.slice(0, 220),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        url: probe.url,
        auth: probe.auth,
        status: 0,
        ok: false,
        bodyPreview: `network/abort: ${msg.slice(0, 200)}`,
      });
    } finally {
      clearTimeout(t);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      tokenLength: token.length,
      tokenPreview: `${token.slice(0, 4)}…${token.slice(-4)}`,
      results,
    },
    { status: 200 },
  );
}
