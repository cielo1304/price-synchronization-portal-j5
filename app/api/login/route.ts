/**
 * POST /api/login
 *
 * Body: { password: string }
 * Если совпало с PORTAL_PASSWORD → ставим cookie portal_session
 * со значением sha256(PORTAL_PASSWORD), HttpOnly, Secure, 30 дней.
 */
import { NextResponse } from "next/server";
import { SESSION_COOKIE, expectedSessionHash } from "@/lib/auth";

// Маленькая «налогом-задержка» против перебора. Не настоящий rate-limit,
// но миллион попыток в секунду уже невозможен.
async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: Request) {
  const expected = process.env.PORTAL_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "PORTAL_PASSWORD не настроен" },
      { status: 500 },
    );
  }

  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Некорректный запрос" },
      { status: 400 },
    );
  }

  const password = typeof body.password === "string" ? body.password : "";

  await delay(300); // защита от brute-force (для 2-5 человек этого хватает)

  if (password !== expected) {
    return NextResponse.json(
      { ok: false, error: "Неверный пароль" },
      { status: 401 },
    );
  }

  const sessionValue = await expectedSessionHash();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 дней
  });
  return res;
}
