/**
 * POST /api/login
 *
 * Body: { password: string }
 * Если совпало с любым из PORTAL_PASSWORD / PORTAL_PASSWORD_2 / ... →
 * ставим cookie portal_session со значением sha256(введённого пароля),
 * HttpOnly, Secure, 30 дней. Каждый сотрудник получит свою cookie —
 * смена одного пароля не разлогинит остальных.
 */
import { NextResponse } from "next/server";
import { SESSION_COOKIE, expectedSessionHashes, sha256Hex } from "@/lib/auth";

// Маленькая «налогом-задержка» против перебора. Не настоящий rate-limit,
// но миллион попыток в секунду уже невозможен.
async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: Request) {
  let validHashes: string[];
  try {
    validHashes = await expectedSessionHashes();
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "PORTAL_PASSWORD не настроен",
      },
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

  // Хешируем введённый пароль один раз и сравниваем с каждым из
  // допустимых хешей в постоянное время.
  const candidate = await sha256Hex(password);
  let matched = 0;
  for (const exp of validHashes) {
    let diff = 0;
    if (candidate.length === exp.length) {
      for (let i = 0; i < exp.length; i++) {
        diff |= candidate.charCodeAt(i) ^ exp.charCodeAt(i);
      }
      matched |= diff === 0 ? 1 : 0;
    }
  }

  if (matched !== 1) {
    return NextResponse.json(
      { ok: false, error: "Неверный пароль" },
      { status: 401 },
    );
  }

  // В cookie кладём хеш именно того пароля, который ввели. Тогда
  // смена/удаление одного пароля разлогинит только его владельца.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, candidate, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 дней
  });
  return res;
}
