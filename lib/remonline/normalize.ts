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
  // Защита: если пришло не-строковое значение из РО — приводим к строке.
  const safe = typeof s === "string" ? s : String(s ?? "");
  return safe
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/й/g, "и")
    .replace(/[\[\]()]/g, " ")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Достаёт цену из объекта услуги/товара РО.
 *  Цена бывает:
 *   • в `price` (single);
 *   • в `prices` как ОБЪЕКТ { "<marginId>": число } — реальный ответ v2 API;
 *   • в `prices` как массив [{ price: number }] — старый формат.
 *  Опционально можно указать preferMarginId, чтобы взять конкретный тип цены
 *  (например id "Стандартной цены"). */
export function priceOf(
  s:
    | {
        price?: number | null;
        prices?: Record<string, number> | Array<{ price: number }> | null;
      }
    | undefined
    | null,
  preferMarginId?: string | number,
): number | null {
  if (!s) return null;
  const p = s.prices;
  if (p && !Array.isArray(p)) {
    // Объектный формат { marginId: value }
    if (preferMarginId != null && typeof p[String(preferMarginId)] === "number") {
      return p[String(preferMarginId)];
    }
    // Иначе — первое ненулевое значение, при отсутствии — 0/первое
    const values = Object.values(p).filter((v) => typeof v === "number");
    const nonZero = values.find((v) => v > 0);
    if (nonZero != null) return nonZero;
    if (values.length > 0) return values[0];
  }
  if (typeof s.price === "number") return s.price;
  if (Array.isArray(p) && p.length > 0) return p[0].price;
  return null;
}
