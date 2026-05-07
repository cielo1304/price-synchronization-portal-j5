/**
 * Нормализация имени для сопоставления позиции портала с записью в Remonline.
 *
 * Правила:
 *   • нижний регистр
 *   • ё → е (в РО и в наших данных написание плавает)
 *   • убираем все скобки, дефисы и пунктуацию — оставляем только буквы и цифры
 *   • один пробел между словами, обрезаем края
 *
 * Примеры:
 *   "[i16-DIS] iPhone 16 Дисплей - замена"  → "i16 dis iphone 16 дисплеи замена"
 *   "iPhone 16 [DIS] Дисплей - Снятый оригинал (бу)"
 *     → "iphone 16 dis дисплеи снятыи оригинал бу"
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[й]/g, "и")
    .replace(/[\[\]()]/g, " ")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Достаёт цену из объекта услуги/товара РО.
 *  В РО цена бывает в `price` (single) или в `prices[0].price` (если несколько типов прайса). */
export function priceOf(
  s:
    | { price?: number | null; prices?: Array<{ price: number }> }
    | undefined
    | null,
): number | null {
  if (!s) return null;
  if (typeof s.price === "number") return s.price;
  if (s.prices && s.prices.length > 0) return s.prices[0].price;
  return null;
}
