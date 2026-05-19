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

/**
 * Список валидных паролей из env. Поддерживаем несколько слотов, чтобы
 * у разных сотрудников были разные пароли — один сменили, остальные
 * продолжают работать.
 *
 * Чтобы добавить нового сотрудника, просто заведите новую переменную
 * вида PORTAL_PASSWORD_3, PORTAL_PASSWORD_4 — она автоматически
 * подхватится без правок кода.
 */
function listPasswords(): string[] {
  const pwds: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (key === "PORTAL_PASSWORD" || /^PORTAL_PASSWORD_\d+$/.test(key)) {
      pwds.push(value);
    }
  }
  return pwds;
}

/** Хеши всех текущих PORTAL_PASSWORD* из env. Бросает, если ни одного нет. */
export async function expectedSessionHashes(): Promise<string[]> {
  const pwds = listPasswords();
  if (pwds.length === 0) {
    throw new Error(
      "Не задан ни один PORTAL_PASSWORD*. Добавьте переменную окружения в Vercel.",
    );
  }
  return Promise.all(pwds.map((p) => sha256Hex(p)));
}

/**
 * Совпадает ли cookie-сессия хотя бы с одним из текущих паролей.
 * Сравнение постоянное по времени для каждого хеша; перебор
 * до 10 паролей — это всё ещё доли миллисекунды.
 */
export async function isValidSession(
  cookieValue: string | undefined,
): Promise<boolean> {
  if (!cookieValue) return false;
  try {
    const expected = await expectedSessionHashes();
    let anyMatch = 0;
    for (const exp of expected) {
      if (cookieValue.length !== exp.length) continue;
      let diff = 0;
      for (let i = 0; i < exp.length; i++) {
        diff |= cookieValue.charCodeAt(i) ^ exp.charCodeAt(i);
      }
      // Битовый OR, чтобы не делать ранний return и не выдавать через
      // время сравнения, какой именно пароль совпал.
      anyMatch |= diff === 0 ? 1 : 0;
    }
    return anyMatch === 1;
  } catch {
    return false;
  }
}
