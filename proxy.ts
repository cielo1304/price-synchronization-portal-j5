/**
 * Next.js 16 Proxy (раньше — middleware.ts).
 * Закрывает портал общим паролем PORTAL_PASSWORD.
 *
 * Логика:
 *   - Страницы /login и API /api/login, /api/logout — публичные.
 *   - Всё остальное требует валидной cookie сессии.
 *   - При невалидной сессии для страниц — редирект на /login,
 *     для API — JSON {error:"Unauthorized"} со статусом 401.
 *
 * Статика, _next/* и фавиконки исключены matcher-ом ниже.
 */
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "./lib/auth";

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/login",
  "/api/logout",
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await isValidSession(cookie);
  if (ok) return NextResponse.next();

  // API-роуты возвращают 401, чтобы клиент мог понять, что нужно перелогиниться.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // Страницы редиректим на /login и сохраняем оригинальный URL для возврата.
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("from", pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Все маршруты, КРОМЕ статики и Next-внутренних путей.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon.*|apple-icon.*|robots\\.txt|sitemap\\.xml).*)",
  ],
};
