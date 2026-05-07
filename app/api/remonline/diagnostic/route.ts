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

  // 2. Подтверждённо рабочий список складов (просто для контроля).
  await probe({
    url: "https://api.remonline.app/warehouse/",
    auth: "bearer",
    bearerToken: apiKey,
  });

  // 3. Тестируем разные пути для товаров склада «Склад Сервис» (id=4489).
  //    У РО в разных версиях бывало: /warehouse/goods/{id}/, /goods/{id}/,
  //    /goods/?warehouse_id={id}, /products/?warehouse_id={id}.
  //    Заодно проверяем path с слешем и без.
  const goodsCandidates = [
    "https://api.remonline.app/warehouse/goods/4489/",
    "https://api.remonline.app/warehouse/goods/4489",
    "https://api.remonline.app/warehouse/goods/?warehouse_id=4489",
    "https://api.remonline.app/warehouse/4489/goods/",
    "https://api.remonline.app/goods/4489/",
    "https://api.remonline.app/goods/?warehouse_id=4489",
    "https://api.remonline.app/products/?warehouse_id=4489",
    "https://api.remonline.app/catalog/products/?warehouse_id=4489",
    "https://api.remonline.app/catalog/?warehouse_id=4489",
  ];
  for (const url of goodsCandidates) {
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
