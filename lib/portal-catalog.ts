import type {
  Cell,
  Output,
  Position,
  PositionStub,
  Stage,
} from "./portal-types";
import type { CustomModel, CustomService } from "./portal-custom-models";
import rawPositions from "./portal-positions.json";
import { normalizeName } from "./remonline/normalize";

/**
 * Каталог прайс-портала.
 *
 * Источник истины — Google-таблица, экстрагированная скриптом
 * scripts/extract-all.js в lib/portal-positions.json.
 *
 * Архитектура:
 *   • CATALOG_INDEX — массив "заголовков" (PositionStub) для навигатора слева.
 *   • getPositionById(id) — лениво строит полную Position со стадиями и
 *     выгрузками. Результат кэшируется.
 */

// ── Сырые записи из ПРАЙС_ЛИСТ ──────────────────────────────────────────
type RawSource = {
  rowInPriceList: number;
  code: string | null;
  family: string;
  model: string;
  service: string;
  warrantyDays: number | null;
  finalPrice: number | null;
  range: string | null;
  formula: string | null;
  priceListSheetRef: string;
  priceListRangeRef: string | null;
  labor: {
    sheetRef: string;
    name: string;
    price: number | null;
    duration: string | null;
    warranty: number | null;
  } | null;
  part: {
    sheetRef: string;
    sheetRefRetail: string;
    name: string;
    partId: string | null;
    model: string;
    category: string;
    purchaseICmp: number | null;
    purchaseMOS: number | null;
    purchase: number | null;
    markupPct: number | null;
    retailForPrice: number | null;
    purchaseRO: number | null;
    retailRO: number | null;
  } | null;
  mysklad: {
    sheetRef?: string;
    url?: string;
    time?: string;
    warranty?: string;
    description?: string;
    priceFrom?: unknown;
  } | null;
  competitorPrice: number | null;
};

const records = rawPositions as unknown as RawSource[];

// ── Утилиты ─────────────────────────────────────────────────────────────
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

// MROUND как в Google Sheets: 16304.7 → 16300, 16325 → 16350.
const roundToStep = (n: number, step: number) =>
  Math.round(n / step) * step;

// Генерируем устойчивый id из строки ПРАЙС_ЛИСТ — это уникально и стабильно.
function makeId(rec: RawSource): string {
  return `${slug(rec.model)}.${rec.rowInPriceList}`;
}

// Разбираем услугу на категорию + вариант.
//   "Дисплей - замена на СНЯТЫЙ ОРИГИНАЛ (бу)"
//        → cat = "Дисплей — замена", var = "СНЯТЫЙ ОРИГИНАЛ (бу)"
//   "Замена аккумулятора"
//        → cat = "Аккумулятор", var = "Замена"
//   "Корпус - замена"
//        → cat = "Корпус", var = "замена"
function classifyService(service: string): {
  category: string;
  variant: string;
} {
  const s = service.trim();

  // Шаблон "X - Y на Z"
  const m1 = s.match(/^(.+?)\s*[—-]\s*(.+?)\s+на\s+(.+)$/i);
  if (m1) {
    return {
      category: `${m1[1].trim()} — ${m1[2].trim().toLowerCase()}`,
      variant: m1[3].trim(),
    };
  }

  // Шаблон "X - Y"
  const m2 = s.match(/^(.+?)\s*[—-]\s*(.+)$/);
  if (m2) {
    return {
      category: m2[1].trim(),
      variant: m2[2].trim(),
    };
  }

  // Шаблон "Замена X"
  const m3 = s.match(/^Замена\s+(.+)$/i);
  if (m3) {
    const noun = m3[1].trim();
    // нормализуем род: "аккумулятора" → "аккумулятор"
    const head = noun.replace(
      /(а|ы|и|у|е|я|ой|ий|его|ого|ому|ему)$/i,
      "",
    );
    return {
      category: head.charAt(0).toUpperCase() + head.slice(1),
      variant: "Замена",
    };
  }

  return { category: s, variant: "" };
}

// Парсер строки длительности "30 мин" → 30
function parseMinutes(duration: string | null): number {
  if (!duration) return 0;
  const m = duration.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Услуги, для которых запчасть не подразумевается по природе.
 * Для них предупреждение «уточняйте цену на запчасть» НЕ показывается.
 *   • Диагностика (любая)
 *   • Чистка сеток динамиков и разъёма зарядки
 *   • Профилактика после воды
 *   • Пылевлагозащита — восстановление
 */
export function isPartExempt(serviceName: string, category?: string): boolean {
  const haystack = `${category ?? ""} ${serviceName}`.toLowerCase();
  if (/диагностик/.test(haystack)) return true;
  if (/чистк/.test(haystack)) return true;
  if (/профилактик/.test(haystack)) return true;
  if (/пыле\s*влаг/.test(haystack)) return true;
  return false;
}

// ── Лёгкий stub для навигатора ──────────────────────────────────────────
function recordToStub(rec: RawSource): PositionStub {
  const { category, variant } = classifyService(rec.service);
  const isDraft =
    rec.labor === null ||
    rec.labor.price === null ||
    (rec.formula?.includes("БД_ЗАПЧАСТИ") &&
      (!rec.part || rec.part.purchase === null));

  return {
    id: makeId(rec),
    device: rec.model,
    family: rec.family,
    category,
    variant,
    code: rec.code,
    finalPrice: rec.finalPrice,
    warranty: rec.warrantyDays ? `${rec.warrantyDays} дней` : "—",
    draft: isDraft,
    // Ключи для матчинга с Remonline. Имя услуги/запчасти из исходных данных
    // приводим к нормализованной форме — по ней snapshot ищет соответствие.
    roServiceKey: rec.labor?.name ? normalizeName(rec.labor.name) : undefined,
    roPartKey: rec.part?.name ? normalizeName(rec.part.name) : undefined,
  };
}

// ── Полная Position со стадиями и выгрузками ────────────────────────────
function recordToPosition(rec: RawSource): Position {
  const id = makeId(rec);
  const { category, variant } = classifyService(rec.service);

  const stages: Stage[] = [];

  // 1) Источники цен запчасти
  const part = rec.part;
  const hasPart = !!part;
  // Услуги, у которых запчасть не подразумевается по природе:
  // диагностика, чистка сеток, профилактика после воды.
  // Для таких услуг предупреждение НЕ показываем.
  const partExempt = isPartExempt(rec.service, category);
  const sources: Array<{
    key: string;
    label: string;
    price: number | null;
    sheetRef?: string;
  }> = [];

  if (part) {
    sources.push({
      key: "icomponents",
      label: "iComponents",
      price: part.purchaseICmp,
      sheetRef: part.sheetRef.replace(/!P\d+/, `!I${part.sheetRef.match(/\d+/)?.[0] ?? ""}`),
    });
    sources.push({
      key: "moslcd",
      label: "MOS-LCD",
      price: part.purchaseMOS,
      sheetRef: part.sheetRef.replace(/!P\d+/, `!L${part.sheetRef.match(/\d+/)?.[0] ?? ""}`),
    });
  }

  const validSources = sources.filter(
    (s): s is typeof s & { price: number } => s.price !== null,
  );
  const hasParsed = validSources.length > 0;
  const purchase = part?.purchase ?? (hasParsed ? Math.max(...validSources.map((s) => s.price)) : 0);
  const markupPct = part?.markupPct ?? 0;

  if (hasPart) {
    stages.push({
      id: "sources",
      title: "Источники цен",
      subtitle: "Парсеры поставщиков запчасти",
      canAdd: true,
      cells: sources.map(
        (s): Cell => ({
          address: `${id}.part.sources.${s.key}`,
          label: s.label,
          kind: "source",
          value: s.price,
          unit: "₽",
          source: `парсер: ${s.label}`,
          sheetRef: s.sheetRef,
          note:
            s.price === null
              ? "Парсер не вернул цену — нет в наличии у поставщика"
              : "Обновляется автоматически",
        }),
      ),
    });

    const partRoKey = part?.name ? normalizeName(part.name) : undefined;
    // У запчасти в исходной таблице (а значит и в карточке РО) есть до
    // четырёх идентификаторов: ID, Код, Артикул, Штрихкод. РО `?search=`
    // ищет по любому из них (кроме самого ID, у которого собственный
    // эндпоинт), поэтому забираем все, какие есть, и решение, что в
    // итоге слать в `?search=`, оставляем серверу остатков.
    // Сейчас в JSON живёт только `partId` — он у вас совпадает с «Код»
    // в карточке РО, поэтому используем его как partCode (а заодно
    // и как partProductId — на всякий, если понадобится резолв через
    // /products/{id}). Когда дозаполните остальные колонки в исходнике,
    // достаточно будет добавить их сюда.
    const partAny = part as {
      partId?: string | null;
      partCode?: string | null;
      partArticle?: string | null;
      partBarcode?: string | null;
    } | null;
    const cleanId = (v?: string | null) => {
      if (!v) return null;
      const s = v.replace(/\s+/g, "").trim();
      return s.length ? s : null;
    };
    const partProductId = cleanId(partAny?.partId);
    const partCode = cleanId(partAny?.partCode) ?? cleanId(partAny?.partId);
    const partArticleRaw = cleanId(partAny?.partArticle);
    const partBarcodeRaw = cleanId(partAny?.partBarcode);

    stages.push({
      id: "purchase",
      title: "Закупочная",
      subtitle: "Берём максимум, чтобы не уйти в минус",
      cells: [
        {
          address: `${id}.part.purchase_price`,
          label: "Закупка",
          kind: "auto",
          value: purchase || null,
          unit: "₽",
          formula: "MAX(sources)",
          dependsOn: validSources.map((s) => `${id}.part.sources.${s.key}`),
          note: hasParsed
            ? undefined
            : "Нет данных от поставщиков — нужна ручная закупка",
          roMatch: partRoKey
            ? {
                kind: "part-purchase",
                key: partRoKey,
                partProductId,
                partCode,
                partArticle: partArticleRaw,
                partBarcode: partBarcodeRaw,
              }
            : undefined,
        },
      ],
    });

    stages.push({
      id: "markup",
      title: "Наценка",
      subtitle: "Сколько добавляем сверху закупки",
      cells: [
        {
          address: `${id}.part.markup_pct`,
          label: "Наценка",
          kind: "manual",
          value: markupPct,
          unit: "%",
          source: "Установлено вручную",
          sheetRef: part?.sheetRef.replace(/!P/, "!N"),
          note: "В БД_ЗАПЧАСТИ колонка N",
        },
      ],
    });

    const partRetail =
      part?.retailRO ??
      (hasParsed ? roundToStep(purchase * (1 + markupPct / 100), 50) : 0);

    stages.push({
      id: "part_retail",
      title: "Цена запчасти",
      subtitle: "Округляется к ближайшим 50 ₽",
      cells: [
        {
          address: `${id}.part.retail_price`,
          label: "Розница запчасти",
          kind: "formula",
          value: partRetail || null,
          unit: "₽",
          formula: "MROUND(закупка × (1 + наценка/100); 50)",
          dependsOn: [`${id}.part.purchase_price`, `${id}.part.markup_pct`],
          sheetRef: part?.sheetRefRetail,
          note: part?.sheetRefRetail
            ? `Уходит в ${part.sheetRefRetail} (Q-колонка БД_ЗАПЧАСТИ)`
            : undefined,
          roMatch: partRoKey
            ? {
                kind: "part-retail",
                key: partRoKey,
                partProductId,
                partCode,
                partArticle: partArticleRaw,
                partBarcode: partBarcodeRaw,
              }
            : undefined,
        },
      ],
    });
  } else {
    // Услуга без запчасти — оставляем место в шаблоне как 4 placeholder-стадии,
    // чтобы визуально структура была одинаковой для всех услуг.
    stages.push(
      {
        id: "sources",
        title: "Источники цен",
        subtitle: "Запчасть не используется",
        placeholder: true,
        cells: [
          {
            address: `${id}.part.sources.placeholder`,
            label: "Источников нет",
            kind: "source",
            value: null,
            note: "Для этой услуги запчасть не предусмотрена",
          },
        ],
      },
      {
        id: "purchase",
        title: "Закупочная",
        subtitle: "—",
        placeholder: true,
        cells: [
          {
            address: `${id}.part.purchase_price`,
            label: "Закупка",
            kind: "auto",
            value: null,
            note: "Запчасть не используется",
          },
        ],
      },
      {
        id: "markup",
        title: "Наценка",
        subtitle: "—",
        placeholder: true,
        cells: [
          {
            address: `${id}.part.markup_pct`,
            label: "Наценка",
            kind: "manual",
            value: null,
            unit: "%",
            note: "Запчасть не используется",
          },
        ],
      },
      {
        id: "part_retail",
        title: "Цена запчасти",
        subtitle: "—",
        placeholder: true,
        cells: [
          {
            address: `${id}.part.retail_price`,
            label: "Розница запчасти",
            kind: "formula",
            value: null,
            note: "Запчасть не используется",
          },
        ],
      },
    );
  }

  // 2) Работа
  const laborPrice = rec.labor?.price ?? 0;
  const laborRoKey = rec.labor?.name
    ? normalizeName(rec.labor.name)
    : undefined;
  stages.push({
    id: "labor",
    title: "Работа",
    subtitle: hasPart ? "Стоимость замены" : "Стоимость работы",
    cells: [
      {
        address: `${id}.labor.price`,
        label: "Стоимость работы",
        kind: "manual",
        value: laborPrice || null,
        unit: "₽",
        source: "БД_УСЛУГИ_РО · колонка P",
        sheetRef: rec.labor?.sheetRef,
        note: rec.labor?.sheetRef
          ? `Источник истины: ${rec.labor.sheetRef}`
          : undefined,
        roMatch: laborRoKey
          ? { kind: "service-price", key: laborRoKey }
          : undefined,
      },
    ],
  });

  // 3) Конкурент
  if (rec.competitorPrice !== null && rec.competitorPrice !== undefined) {
    stages.push({
      id: "competitor",
      title: "Конкурент",
      subtitle: "Ремонт яблок · референс",
      cells: [
        {
          address: `${id}.competitor.remontyablok`,
          label: "Ремонт яблок",
          kind: "source",
          value: rec.competitorPrice,
          unit: "₽",
          source: "парсер remontyablok.ru",
          sheetRef: "РЕМОНТ_ЯБЛОК",
          note: "Используется как референс при корректировке цены",
        },
      ],
    });
  }

  // 4) Финальная цена
  const finalPrice = rec.finalPrice ?? laborPrice + (hasPart ? (part?.retailRO ?? 0) : 0);
  stages.push({
    id: "final",
    title: "Конечная цена",
    subtitle: hasPart ? "Запчасть + работа" : "Только работа",
    cells: [
      {
        address: `${id}.service.final_price`,
        label: "Цена услуги",
        kind: "formula",
        value: finalPrice,
        unit: "₽",
        formula: hasPart
          ? "part.retail_price + labor.price"
          : "labor.price",
        dependsOn: hasPart
          ? [`${id}.part.retail_price`, `${id}.labor.price`]
          : [`${id}.labor.price`],
        sheetRef: rec.priceListSheetRef,
        note: `В Google Sheets: ${rec.priceListSheetRef} (формула F)`,
        isFinal: true,
        warning:
          !hasPart && !partExempt
            ? "Внимание, для данной услуги нет запчасти, уточняйте цену на запчасть!"
            : undefined,
      },
    ],
  });

  // ── Выгрузки ──────────────────────────────────────────────────────────
  const outputs: Output[] = [
    {
      id: "site",
      name: "maxmobiles.ru",
      description: "Карточка услуги на сайте",
      status: "synced",
      lastSyncedAt: rec.mysklad?.url ? "из МойСклад" : "—",
      fields: [
        {
          label: "Цена",
          fromAddress: `${id}.service.final_price`,
          value: finalPrice,
          unit: "₽",
        },
      ],
    },
    {
      id: "moysklad",
      name: "МойСклад",
      description: rec.mysklad
        ? "Карточка товара/услуги"
        : "Не подключено",
      status: rec.mysklad ? "synced" : "pending",
      lastSyncedAt: rec.mysklad?.sheetRef ?? "ожидает синхронизации",
      fields: [
        {
          label: "Цена продажи",
          fromAddress: `${id}.service.final_price`,
          value: finalPrice,
          unit: "₽",
        },
      ],
    },
    {
      id: "remonline",
      name: "Ремонлайн",
      description: hasPart ? "Запчасть + работа отдельно" : "Только работа",
      status: "synced",
      lastSyncedAt: rec.code ? `код ${rec.code}` : "без кода",
      fields: hasPart
        ? [
            {
              label: "Закупочная запчасти",
              fromAddress: `${id}.part.purchase_price`,
              value: purchase,
              unit: "₽",
            },
            {
              label: "Розница запчасти",
              fromAddress: `${id}.part.retail_price`,
              value: part?.retailRO ?? 0,
              unit: "₽",
            },
            {
              label: "Работа",
              fromAddress: `${id}.labor.price`,
              value: laborPrice,
              unit: "₽",
            },
          ]
        : [
            {
              label: "Работа",
              fromAddress: `${id}.labor.price`,
              value: laborPrice,
              unit: "₽",
            },
          ],
    },
  ];

  return {
    id,
    device: rec.model,
    serviceName: rec.service,
    category,
    variant,
    code: rec.code ?? "—",
    warranty: rec.warrantyDays ? `${rec.warrantyDays} дней` : "—",
    laborMinutes: parseMinutes(rec.labor?.duration ?? null),
    stages,
    outputs,
    draft:
      rec.labor === null ||
      rec.labor.price === null ||
      (hasPart && !hasParsed),
    noPartWarning:
      !hasPart && !partExempt
        ? "Внимание, для данной услуги нет запчасти, уточняйте цену на запчасть!"
        : undefined,
  };
}

// ── Публичный API ──────────────────────────────────────────────────────
const recordsById = new Map<string, RawSource>(
  records.map((r) => [makeId(r), r]),
);

const positionCache = new Map<string, Position>();

export const CATALOG_INDEX: PositionStub[] = records.map(recordToStub);

/**
 * Отпечаток цен позиции — лёгкая структура с только теми числами, что нужны
 * для сравнения с Remonline. Используется для быстрого подсчёта конфликтов
 * в каталоге без построения полных Position-объектов.
 */
export type PricingFingerprint = {
  positionId: string;
  device: string;
  roServiceKey?: string;
  laborPrice: number | null;
  roPartKey?: string;
  partRetail: number | null;
  partPurchase: number | null;
};

export const PRICING_FINGERPRINTS: PricingFingerprint[] = records.map(
  (rec): PricingFingerprint => ({
    positionId: makeId(rec),
    device: rec.model,
    roServiceKey: rec.labor?.name ? normalizeName(rec.labor.name) : undefined,
    laborPrice: rec.labor?.price ?? null,
    roPartKey: rec.part?.name ? normalizeName(rec.part.name) : undefined,
    partRetail: rec.part?.retailRO ?? null,
    partPurchase: rec.part?.purchase ?? null,
  }),
);

export function getPositionById(id: string): Position | null {
  if (positionCache.has(id)) return positionCache.get(id)!;
  const rec = recordsById.get(id);
  if (!rec) return null;
  const pos = recordToPosition(rec);
  positionCache.set(id, pos);
  return pos;
}

// ── Группировка для левой панели ───────────────────────────────────────
export type CatalogGroup = {
  device: string;
  positions: PositionStub[];
};

// Сортировка моделей iPhone в порядке выхода — от новых к старым.
// Группы по году релиза:
//   17 (2025) → 16 (2024) → 15 (2023) → 14 (2022) → 13 (2021) → 12 (2020) →
//   11 (2019) → XS/XS Max/XR (2018) → X (2017) → 8/8+ (2017) → 7/7+ (2016) →
//   SE 2016 → 6S/6S+ (2015) → 6/6+ (2014) → 5S/5C (2013) → 5 (2012).
// SE 2/SE 3 ставим рядом со своим поколением (11 и 13).
// Внутри поколения: Pro Max → Pro → Air → Plus → base → 16E → mini.
export function deviceSortKey(device: string): [number, number, string] {
  // SE — отдельная ветка, привязка к году выпуска.
  if (/iPhone\s+SE/i.test(device)) {
    const yearMatch = device.match(/(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 2016;
    let major = 5.5; // SE 2016 — между 5S и 6
    if (year === 2020) major = 11.5; // между 11 и 12
    else if (year === 2022) major = 13.5; // между 13 и 14
    return [major, 9, device];
  }

  // X-серия (между 8 и 11): X (2017), XS / XS Max / XR (2018).
  if (/iPhone\s+X(?!\d)/i.test(device)) {
    if (/XS\s*Max/i.test(device)) return [10.5, 1, device];
    if (/XS/i.test(device)) return [10.5, 2, device];
    if (/XR/i.test(device)) return [10.5, 5, device];
    return [10, 5, device]; // iPhone X
  }

  const m = device.match(/iPhone\s+(\d+)/i);
  const major = m ? parseInt(m[1], 10) : 0;

  // Уров��нь модификации внутри одного поколения.
  let tier = 5; // base
  if (/Pro\s*Max/i.test(device)) tier = 1;
  else if (/Pro/i.test(device)) tier = 2;
  else if (/Air/i.test(device)) tier = 3;
  else if (/Plus/i.test(device)) tier = 4;
  else if (/mini/i.test(device)) tier = 7;
  else if (/^iPhone\s+\d+E$/i.test(device)) tier = 6; // 16E — entry
  else if (/Max/i.test(device)) tier = 1;

  return [major, tier, device];
}

// ── Пользовательские модели ────────────────────────────────────────────

/** ID позиции пользовательской модели: `custom.<modelId>.<serviceIdx>` */
export function customPositionId(modelId: string, serviceIdx: number): string {
  return `custom.${modelId}.${serviceIdx}`;
}

/** Извлекает шаблоны услуг из существующей модели для копирования */
export function extractServiceTemplates(device: string): CustomService[] {
  const stubs = CATALOG_INDEX.filter((s) => s.device === device);
  return stubs.map((stub): CustomService => {
    const pos = getPositionById(stub.id);
    const hasPart = !!pos?.stages.find((s) => s.id === "sources");
    return {
      serviceName: pos?.serviceName ?? `${stub.category} — ${stub.variant}`,
      category: stub.category,
      variant: stub.variant,
      hasPart,
      warrantyDays: parseWarrantyDays(stub.warranty),
      laborDuration: pos && pos.laborMinutes ? `${pos.laborMinutes} мин` : null,
    };
  });
}

/** Лёгкие stubs для всех услуг пользовательских моделей */
export function customStubsFromModels(models: CustomModel[]): PositionStub[] {
  const out: PositionStub[] = [];
  for (const m of models) {
    m.services.forEach((s, i) => {
      out.push({
        id: customPositionId(m.id, i),
        device: m.device,
        family: m.family,
        category: s.category,
        variant: s.variant,
        code: null,
        finalPrice: null,
        warranty: s.warrantyDays ? `${s.warrantyDays} дней` : "—",
        draft: true,
      });
    });
  }
  return out;
}

/** Строит полную Position для пользовательской модели — конвейер пустой */
export function getCustomPosition(
  models: CustomModel[],
  id: string,
): Position | null {
  if (!id.startsWith("custom.")) return null;
  const rest = id.slice("custom.".length);
  const dot = rest.lastIndexOf(".");
  if (dot < 0) return null;
  const modelId = rest.slice(0, dot);
  const idx = parseInt(rest.slice(dot + 1), 10);
  if (Number.isNaN(idx)) return null;
  const model = models.find((m) => m.id === modelId);
  if (!model) return null;
  const svc = model.services[idx];
  if (!svc) return null;
  return buildBlankPosition(model, svc, id);
}

function buildBlankPosition(
  model: CustomModel,
  svc: CustomService,
  id: string,
): Position {
  const stages: Stage[] = [];
  const hasPart = svc.hasPart;
  const partExempt = isPartExempt(svc.serviceName, svc.category);

  if (hasPart) {
    stages.push({
      id: "sources",
      title: "Источники цен",
      subtitle: "Добавьте парсеры поставщиков",
      canAdd: true,
      cells: [
        {
          address: `${id}.part.sources.icomponents`,
          label: "iComponents",
          kind: "source",
          value: null,
          unit: "₽",
          source: "парсер: iComponents",
          note: "Введите URL парсера или установите цену вручную",
        },
        {
          address: `${id}.part.sources.moslcd`,
          label: "MOS-LCD",
          kind: "source",
          value: null,
          unit: "₽",
          source: "парсер: MOS-LCD",
          note: "Введите URL парсера или установите цену вручную",
        },
      ],
    });

    stages.push({
      id: "purchase",
      title: "Закупочная",
      subtitle: "Берём максимум, чтобы не уйти в минус",
      cells: [
        {
          address: `${id}.part.purchase_price`,
          label: "Закупка",
          kind: "auto",
          value: null,
          unit: "₽",
          formula: "MAX(sources)",
          dependsOn: [
            `${id}.part.sources.icomponents`,
            `${id}.part.sources.moslcd`,
          ],
          note: "Заполнится автоматически после ввода источников",
        },
      ],
    });

    stages.push({
      id: "markup",
      title: "Наценка",
      subtitle: "Сколько добавляем сверху",
      cells: [
        {
          address: `${id}.part.markup_pct`,
          label: "Наценка",
          kind: "manual",
          value: null,
          unit: "%",
          source: "Введите вручную",
          note: "Например, 15 — это +15% к закупке",
        },
      ],
    });

    stages.push({
      id: "part_retail",
      title: "Цена запчасти",
      subtitle: "Округляется к ближайшим 50 ₽",
      cells: [
        {
          address: `${id}.part.retail_price`,
          label: "Розница запчасти",
          kind: "formula",
          value: null,
          unit: "₽",
          formula: "MROUND(закупка × (1 + наценка/100); 50)",
          dependsOn: [`${id}.part.purchase_price`, `${id}.part.markup_pct`],
          note: "Заполнится автоматически",
        },
      ],
    });
  } else {
    // Услуга без запчасти — placeholder-стадии для единообразия структуры
    stages.push(
      {
        id: "sources",
        title: "Источники цен",
        subtitle: "Запчасть не используется",
        placeholder: true,
        cells: [
          {
            address: `${id}.part.sources.placeholder`,
            label: "Источников нет",
            kind: "source",
            value: null,
            note: "Для этой услуги запчасть не предусмотрена",
          },
        ],
      },
      {
        id: "purchase",
        title: "Закупочная",
        subtitle: "—",
        placeholder: true,
        cells: [
          {
            address: `${id}.part.purchase_price`,
            label: "Закупка",
            kind: "auto",
            value: null,
            note: "Запчасть не используется",
          },
        ],
      },
      {
        id: "markup",
        title: "Наценка",
        subtitle: "—",
        placeholder: true,
        cells: [
          {
            address: `${id}.part.markup_pct`,
            label: "Наценка",
            kind: "manual",
            value: null,
            unit: "%",
            note: "Запчасть не используется",
          },
        ],
      },
      {
        id: "part_retail",
        title: "Цена запчасти",
        subtitle: "—",
        placeholder: true,
        cells: [
          {
            address: `${id}.part.retail_price`,
            label: "Розница запчасти",
            kind: "formula",
            value: null,
            note: "Запчасть не используется",
          },
        ],
      },
    );
  }

  stages.push({
    id: "labor",
    title: "Работа",
    subtitle: hasPart ? "Стоимость замены" : "Стоимость работы",
    cells: [
      {
        address: `${id}.labor.price`,
        label: "Стоимость работы",
        kind: "manual",
        value: null,
        unit: "₽",
        source: "Введите вручную",
        note: "Попадёт в БД_УСЛУГИ_РО колонка P",
      },
    ],
  });

  stages.push({
    id: "final",
    title: "Конечная цена",
    subtitle: hasPart ? "Запчасть + работа" : "Только работа",
    cells: [
      {
        address: `${id}.service.final_price`,
        label: "Цена услуги",
        kind: "formula",
        value: null,
        unit: "₽",
        formula: hasPart
          ? "part.retail_price + labor.price"
          : "labor.price",
        dependsOn: hasPart
          ? [`${id}.part.retail_price`, `${id}.labor.price`]
          : [`${id}.labor.price`],
        note: "Заполнится после ввода всех данных выше",
        isFinal: true,
        warning:
          !hasPart && !partExempt
            ? "Внимание, для данной услуги нет запчасти, уточняйте цену на запчасть!"
            : undefined,
      },
    ],
  });

  const outputs: Output[] = [
    {
      id: "site",
      name: "maxmobiles.ru",
      description: "Карточка услуги на сайте",
      status: "pending",
      lastSyncedAt: "ожидает заполнения",
      fields: [
        {
          label: "Цена",
          fromAddress: `${id}.service.final_price`,
          value: 0,
          unit: "₽",
        },
      ],
    },
    {
      id: "moysklad",
      name: "МойСклад",
      description: "Карточка товара/услуги",
      status: "pending",
      lastSyncedAt: "ожидает заполнения",
      fields: [
        {
          label: "Цена продажи",
          fromAddress: `${id}.service.final_price`,
          value: 0,
          unit: "₽",
        },
      ],
    },
    {
      id: "remonline",
      name: "Ремонлайн",
      description: hasPart ? "Запчасть + работа отдельно" : "Только работа",
      status: "pending",
      lastSyncedAt: "ожидает заполнения",
      fields: hasPart
        ? [
            {
              label: "Закупочная запчасти",
              fromAddress: `${id}.part.purchase_price`,
              value: 0,
              unit: "₽",
            },
            {
              label: "Розница запчасти",
              fromAddress: `${id}.part.retail_price`,
              value: 0,
              unit: "₽",
            },
            {
              label: "Работа",
              fromAddress: `${id}.labor.price`,
              value: 0,
              unit: "₽",
            },
          ]
        : [
            {
              label: "Работа",
              fromAddress: `${id}.labor.price`,
              value: 0,
              unit: "₽",
            },
          ],
    },
  ];

  return {
    id,
    device: model.device,
    serviceName: svc.serviceName,
    category: svc.category,
    variant: svc.variant,
    code: "—",
    warranty: svc.warrantyDays ? `${svc.warrantyDays} дней` : "—",
    laborMinutes: parseMinutes(svc.laborDuration),
    stages,
    outputs,
    draft: true,
    noPartWarning:
      !hasPart && !partExempt
        ? "Внимание, для данной услуги нет запчасти, уточняйте цену на запчасть!"
        : undefined,
  };
}

function parseWarrantyDays(s: string): number | null {
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function groupCatalog(stubs: PositionStub[]): CatalogGroup[] {
  const map = new Map<string, PositionStub[]>();
  for (const s of stubs) {
    if (!map.has(s.device)) map.set(s.device, []);
    map.get(s.device)!.push(s);
  }
  return Array.from(map.entries())
    .sort((a, b) => {
      const [ma, ta, na] = deviceSortKey(a[0]);
      const [mb, tb, nb] = deviceSortKey(b[0]);
      // Мажорная версия — по убыванию (новые сверху).
      if (ma !== mb) return mb - ma;
      // Внутри одной версии — Pro Max сверху, базовая в середине, mini внизу.
      if (ta !== tb) return ta - tb;
      return na.localeCompare(nb, "ru");
    })
    .map(([device, positions]) => ({ device, positions }));
}
