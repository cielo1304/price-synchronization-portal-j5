import { NextResponse } from "next/server";
import { updateService, updateProduct } from "@/lib/remonline/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Точечная запись в Remonline по одной ячейке портала.
 * Принимает roId (полученный с клиента из snapshot) и patch.
 *
 * Тело:
 *   { kind: "service", roId: number, patch: { price?, duration? } }
 *   { kind: "product", roId: number, patch: { price?, custom_price? } }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      kind: "service" | "product";
      roId: number;
      patch: Record<string, number | string>;
    };

    if (!body || typeof body.roId !== "number") {
      return NextResponse.json(
        { ok: false, error: "Не указан roId" },
        { status: 400 },
      );
    }

    if (body.kind === "service") {
      await updateService(body.roId, body.patch as { price?: number; duration?: number });
    } else if (body.kind === "product") {
      await updateProduct(
        body.roId,
        body.patch as { price?: number; custom_price?: number },
      );
    } else {
      return NextResponse.json(
        { ok: false, error: `Неизвестный kind: ${body.kind}` },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
