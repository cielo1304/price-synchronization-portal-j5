/**
 * Простая авторизация через единый общий пароль (PORTAL_PASSWORD).
 *
 * Принцип работы:
 *   1. Сервер сравнивает введённый пароль с PORTAL_PASSWORD.
 *   2. Если совпал — кладёт в cookie SHA-256(PORTAL_PASSWORD).
 *   3. На каждом запросе proxy.ts достаёт cookie и сравнивает её с
 *      SHA-256(текущего PORTAL_PASSWORD) — если не совпало, редирект
 *      на /login.
 *
 * Это даёт «бесплатный logout всех» при смене пароля в Vercel: новый
 * хеш не совпадёт ни с одним старым cookie, и все сессии разом
 * аннулируются. Никакой БД, никаких JWT, никакого секрет-ключа сверху.
 *
 * Уязвимости, о которых стоит знать:
 *   - Любой, кто знает PORTAL_PASSWORD, может локально посчитать его
 *     SHA-256 и подделать cookie. Это нормально — он и так знает пароль
 *     и может авторизоваться обычным способом.
 *   - Лимита попыток нет. Для 2-5 доверенных людей это ок; если
 *     понадобится защита от перебора — добавим rate-limit на /api/login.
 */

export const SESSION_COOKIE = "portal_session";

/**
 * Хеш-функция SHA-256, работающая И в Node-runtime (route handlers),
 * И в Edge-runtime (proxy.ts). Используем Web Crypto, который доступен
 * везде, начиная с Node 20+.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Хеш текущего PORTAL_PASSWORD из env. Бросает, если переменной нет. */
export async function expectedSessionHash(): Promise<string> {
  const pwd = process.env.PORTAL_PASSWORD;
  if (!pwd) {
    throw new Error(
      "PORTAL_PASSWORD не задан. Добавьте переменную окружения в Vercel.",
    );
  }
  return sha256Hex(pwd);
}

/** Совпадает ли cookie-сессия с текущим PORTAL_PASSWORD. */
export async function isValidSession(
  cookieValue: string | undefined,
): Promise<boolean> {
  if (!cookieValue) return false;
  try {
    const expected = await expectedSessionHash();
    // Постоянная по времени сравнения — у обеих строк всегда длина 64.
    if (cookieValue.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= cookieValue.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}
