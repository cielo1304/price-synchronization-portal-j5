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

  // 1. Карта API без авторизации — должна отдать JSON со ссылками.
  await probe({ url: "https://api.roapp.io/", auth: "none" });

  // 2. Главная проба: api-key как Bearer на api.remonline.app.
  //    Это формат из официальных Python/PHP-примеров документации.
  //    Никакого обмена на session-token не нужно — api-key самодостаточен.
  const bearerCandidates = [
    "https://api.remonline.app/warehouse/", // список складов
    "https://api.remonline.app/services/", // список услуг
    "https://api.remonline.app/branches", // список филиалов
    "https://api.remonline.app/tasks", // список заявок (для контроля)
  ];
  for (const url of bearerCandidates) {
    await probe({ url, auth: "bearer", bearerToken: apiKey });
  }

  return NextResponse.json(
    {
      ok: true,
      tokenLength: apiKey.length,
      tokenPreview: `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`,
      sessionToken: null,
      results,
    },
    { status: 200 },
  );
}
