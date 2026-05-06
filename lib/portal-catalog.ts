import type { Cell, Output, Position, Stage } from "./portal-types";

// Фабрика создаёт Position из простых параметров.
// Цифры ниже — РЕАЛЬНЫЕ данные из вашей Google Sheets:
//   ПРАЙС_ЛИСТ, БД_УСЛУГИ_РО (колонка P), БД_ЗАПЧАСТИ, РЕМОНТ_ЯБЛОК.
// Источник истины для стоимости работы — БД_УСЛУГИ_РО колонка P.
// Лист МАТРИЦА_СТОИМОСТИ_РАБОТ намеренно не используется — это задел
// под будущие коэффициенты от базовой модели.

type Source = {
  key: string;
  label: string;
  /** Цена поставщика. null = парсер не вернул (нет в наличии) */
  price: number | null;
  sheetRef?: string;
};

type PositionInput = {
  id: string;
  device: string;
  /** Полное название услуги (E-колонка в БД_УСЛУГИ_РО) */
  serviceName: string;
  category: string;
  variant: string;
  /** Код услуги в Ремонлайне (i16-DIS, i16-BAT и т.д.) */
  code: string;
  warranty: string;
  laborMinutes: number;
  /** Источники цен запчасти. Пусто = только работа без запчасти */
  sources?: Source[];
  /** Наценка % (из БД_ЗАПЧАСТИ.N) */
  markupPct?: number;
  /** Шаг округления розницы запчасти */
  roundStep?: number;
  /** Стоимость работы (БД_УСЛУГИ_РО.P) */
  laborPrice: number;
  /** Адрес работы в Google Sheets, например "БД_УСЛУГИ_РО!P916" */
  laborSheetRef?: string;
  /** Цена конкурента "Ремонт яблок" из РЕМОНТ_ЯБЛОК */
  competitorPrice?: number;
  competitorSheetRef?: string;
  /** Адрес итоговой строки в БД_ЗАПЧАСТИ для запчасти (для P-колонки) */
  partRetailSheetRef?: string;
  /** Адрес строки в ПРАЙС_ЛИСТ для итоговой цены */
  priceListSheetRef?: string;
  /** Адрес карточки в БД_МОЙ СКЛАД */
  moyskladSheetRef?: string;
  draft?: boolean;
};

const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;

export function buildPosition(input: PositionInput): Position {
  const {
    id,
    device,
    serviceName,
    category,
    variant,
    code,
    warranty,
    laborMinutes,
    sources = [],
    markupPct = 0,
    roundStep = 50,
    laborPrice,
    laborSheetRef,
    competitorPrice,
    competitorSheetRef,
    partRetailSheetRef,
    priceListSheetRef,
    moyskladSheetRef,
    draft,
  } = input;

  const validSources = sources.filter((s) => s.price !== null) as Array<
    Source & { price: number }
  >;
  const hasPart = sources.length > 0;
  const hasParsed = validSources.length > 0;
  const purchase = hasParsed ? Math.max(...validSources.map((s) => s.price)) : 0;
  const partRetail = hasParsed
    ? ceilTo(purchase * (1 + markupPct / 100), roundStep)
    : 0;
  const final = partRetail + laborPrice;

  const stages: Stage[] = [];

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
          sheetRef: partRetailSheetRef
            ? partRetailSheetRef.replace(/!P/, "!N")
            : undefined,
          note: "В БД_ЗАПЧАСТИ колонка N",
        },
      ],
    });

    stages.push({
      id: "part_retail",
      title: "Цена запчасти",
      subtitle: `Округляется вверх до ${roundStep} ₽`,
      cells: [
        {
          address: `${id}.part.retail_price`,
          label: "Розница запчасти",
          kind: "formula",
          value: partRetail || null,
          unit: "₽",
          formula: `CEIL(закупка × (1 + наценка/100), ${roundStep})`,
          dependsOn: [`${id}.part.purchase_price`, `${id}.part.markup_pct`],
          sheetRef: partRetailSheetRef,
          note: partRetailSheetRef
            ? `Уходит в ${partRetailSheetRef} (колонка P в БД_ЗАПЧАСТИ)`
            : undefined,
        },
      ],
    });
  }

  // Стадия "Работа" — фактическая стоимость работы из БД_УСЛУГИ_РО (колонка P)
  stages.push({
    id: "labor",
    title: "Работа",
    subtitle: hasPart ? "Стоимость замены" : "Стоимость работы",
    cells: [
      {
        address: `${id}.labor.price`,
        label: "Стоимость работы",
        kind: "manual",
        value: laborPrice,
        unit: "₽",
        source: "БД_УСЛУГИ_РО · колонка P",
        sheetRef: laborSheetRef,
        note: laborSheetRef
          ? `Источник истины: ${laborSheetRef}`
          : undefined,
      },
    ],
  });

  // Стадия "Конкурент"
  if (competitorPrice !== undefined) {
    stages.push({
      id: "competitor",
      title: "Конкурент",
      subtitle: "Ремонт яблок · референс",
      cells: [
        {
          address: `${id}.competitor.remontyablok`,
          label: "Ремонт яблок",
          kind: "source",
          value: competitorPrice,
          unit: "₽",
          source: "парсер remontyablok.ru",
          sheetRef: competitorSheetRef,
          note: "Используется как референс при корректировке цены",
        },
      ],
    });
  }

  stages.push({
    id: "final",
    title: "Конечная цена",
    subtitle: hasPart ? "Запчасть + работа" : "Только работа",
    cells: [
      {
        address: `${id}.service.final_price`,
        label: "Цена услуги",
        kind: "formula",
        value: final,
        unit: "₽",
        formula: hasPart
          ? "part.retail_price + labor.price"
          : "labor.price",
        dependsOn: hasPart
          ? [`${id}.part.retail_price`, `${id}.labor.price`]
          : [`${id}.labor.price`],
        sheetRef: priceListSheetRef,
        note: priceListSheetRef
          ? `В Google Sheets: ${priceListSheetRef} (формула F)`
          : undefined,
        isFinal: true,
      },
    ],
  });

  const outputs: Output[] = [
    {
      id: "site",
      name: "maxmobiles.ru",
      description: "Карточка услуги на сайте",
      status: "synced",
      lastSyncedAt: "из МойСклад",
      fields: [
        {
          label: "Цена",
          fromAddress: `${id}.service.final_price`,
          value: final,
          unit: "₽",
        },
      ],
    },
    {
      id: "moysklad",
      name: "МойСклад",
      description: moyskladSheetRef
        ? `Карточка ${moyskladSheetRef.split("!")[1] ?? ""}`
        : "Карточка товара/услуги",
      status: hasPart && !hasParsed ? "pending" : "synced",
      lastSyncedAt: moyskladSheetRef ?? "ожидает синхронизации",
      fields: [
        {
          label: "Цена продажи",
          fromAddress: `${id}.service.final_price`,
          value: final,
          unit: "₽",
        },
      ],
    },
    {
      id: "remonline",
      name: "Ремонлайн",
      description: hasPart ? "Запчасть + работа отдельно" : "Только работа",
      status: "synced",
      lastSyncedAt: `код ${code}`,
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
              value: partRetail,
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
    device,
    serviceName,
    category,
    variant,
    code,
    warranty,
    laborMinutes,
    stages,
    outputs,
    draft,
  };
}

// =====================================================================
// КАТАЛОГ. РЕАЛЬНЫЕ ДАННЫЕ из вашей Google-таблицы.
// Источники:
//   ПРАЙС_ЛИСТ строки 1166-1174 (iPhone 16 Дисплей варианты)
//   БД_УСЛУГИ_РО P913-P920 (работы по iPhone 16) — источник истины
//   БД_ЗАПЧАСТИ строки 275-280 (запчасти на дисплей iPhone 16)
//   РЕМОНТ_ЯБЛОК (цены конкурента, подтянуты VLOOKUP)
// =====================================================================

export const CATALOG: Position[] = [
  // iPhone 16 Дисплей — Снятый оригинал (бу) — самый популярный вариант
  buildPosition({
    id: "iphone16.display_orig_used",
    device: "iPhone 16",
    serviceName: "Замена дисплея — Снятый оригинал (бу)",
    category: "Дисплей — замена",
    variant: "Снятый оригинал (бу)",
    code: "i16-DIS",
    warranty: "90 дней",
    laborMinutes: 30,
    sources: [
      {
        key: "icomponents",
        label: "iComponents",
        price: 13900,
        sheetRef: "БД_ЗАПЧАСТИ!I276",
      },
      {
        key: "moslcd",
        label: "MOS-LCD",
        price: null,
        sheetRef: "БД_ЗАПЧАСТИ!L276",
      },
    ],
    markupPct: 17.3,
    laborPrice: 7000,
    laborSheetRef: "БД_УСЛУГИ_РО!P916",
    competitorPrice: 20000,
    competitorSheetRef: "РЕМОНТ_ЯБЛОК",
    partRetailSheetRef: "БД_ЗАПЧАСТИ!P276",
    priceListSheetRef: "ПРАЙС_ЛИСТ!F1167",
  }),

  // iPhone 16 Дисплей — Снятый оригинал (неизвестная деталь)
  buildPosition({
    id: "iphone16.display_orig_unknown",
    device: "iPhone 16",
    serviceName: "Замена дисплея — Снятый оригинал (неизв.)",
    category: "Дисплей — замена",
    variant: "Снятый оригинал (неизв.)",
    code: "i16-DIS",
    warranty: "90 дней",
    laborMinutes: 30,
    sources: [
      {
        key: "icomponents",
        label: "iComponents",
        price: 13200,
        sheetRef: "БД_ЗАПЧАСТИ!I277",
      },
    ],
    markupPct: 18,
    laborPrice: 7000,
    laborSheetRef: "БД_УСЛУГИ_РО!P916",
    competitorPrice: 20000,
    competitorSheetRef: "РЕМОНТ_ЯБЛОК",
    partRetailSheetRef: "БД_ЗАПЧАСТИ!P277",
    priceListSheetRef: "ПРАЙС_ЛИСТ!F1168",
  }),

  // iPhone 16 Дисплей — Восстановленный оригинал (бу)
  buildPosition({
    id: "iphone16.display_refurb_used",
    device: "iPhone 16",
    serviceName: "Замена дисплея — Восстановленный оригинал (бу)",
    category: "Дисплей — замена",
    variant: "Восст. оригинал (бу)",
    code: "i16-DIS",
    warranty: "90 дней",
    laborMinutes: 30,
    sources: [
      {
        key: "icomponents",
        label: "iComponents",
        price: 13400,
        sheetRef: "БД_ЗАПЧАСТИ!I278",
      },
      {
        key: "moslcd",
        label: "MOS-LCD",
        price: 13990,
        sheetRef: "БД_ЗАПЧАСТИ!L278",
      },
    ],
    markupPct: 13,
    laborPrice: 7000,
    laborSheetRef: "БД_УСЛУГИ_РО!P916",
    competitorPrice: 20000,
    competitorSheetRef: "РЕМОНТ_ЯБЛОК",
    partRetailSheetRef: "БД_ЗАПЧАСТИ!P278",
    priceListSheetRef: "ПРАЙС_ЛИСТ!F1169",
  }),

  // iPhone 16 Дисплей — Аналог (запчасти нет в БД)
  buildPosition({
    id: "iphone16.display_copy",
    device: "iPhone 16",
    serviceName: "Замена дисплея — Аналог",
    category: "Дисплей — замена",
    variant: "Аналог",
    code: "i16-DIS",
    warranty: "90 дней",
    laborMinutes: 30,
    sources: [],
    laborPrice: 7000,
    laborSheetRef: "БД_УСЛУГИ_РО!P916",
    competitorPrice: 15000,
    competitorSheetRef: "РЕМОНТ_ЯБЛОК",
    priceListSheetRef: "ПРАЙС_ЛИСТ!F1171",
    draft: true,
  }),

  // iPhone 16 — Переклей разбитого стекла
  buildPosition({
    id: "iphone16.glass_reglue",
    device: "iPhone 16",
    serviceName: "Переклей разбитого стекла дисплея",
    category: "Дисплей — переклей",
    variant: "Без замены модуля",
    code: "i16-DGL",
    warranty: "90 дней",
    laborMinutes: 60,
    sources: [],
    laborPrice: 20000,
    laborSheetRef: "БД_УСЛУГИ_РО!P918",
    competitorPrice: 20000,
    competitorSheetRef: "РЕМОНТ_ЯБЛОК",
    priceListSheetRef: "ПРАЙС_ЛИСТ!F1174",
  }),

  // iPhone 16 Аккумулятор
  buildPosition({
    id: "iphone16.battery",
    device: "iPhone 16",
    serviceName: "Замена аккумулятора",
    category: "Аккумулятор — замена",
    variant: "Оригинал",
    code: "i16-BAT",
    warranty: "180 дней",
    laborMinutes: 25,
    sources: [],
    laborPrice: 7800,
    laborSheetRef: "БД_УСЛУГИ_РО!P913",
    draft: true,
  }),

  // iPhone 16 Разъём зарядки
  buildPosition({
    id: "iphone16.charge_port",
    device: "iPhone 16",
    serviceName: "Замена разъёма зарядки",
    category: "Разъём зарядки",
    variant: "Замена",
    code: "i16-CHG",
    warranty: "90 дней",
    laborMinutes: 45,
    sources: [],
    laborPrice: 7500,
    laborSheetRef: "БД_УСЛУГИ_РО!P915",
    draft: true,
  }),

  // iPhone 16 Камера основная
  buildPosition({
    id: "iphone16.camera_main",
    device: "iPhone 16",
    serviceName: "Замена основной камеры",
    category: "Камера основная",
    variant: "Замена",
    code: "i16-CAMR",
    warranty: "90 дней",
    laborMinutes: 30,
    sources: [],
    laborPrice: 7000,
    laborSheetRef: "БД_УСЛУГИ_РО!P919",
    draft: true,
  }),

  // iPhone 16 Камера фронтальная
  buildPosition({
    id: "iphone16.camera_front",
    device: "iPhone 16",
    serviceName: "Замена фронтальной камеры",
    category: "Камера фронтальная",
    variant: "Замена",
    code: "i16-CAMF",
    warranty: "90 дней",
    laborMinutes: 30,
    sources: [],
    laborPrice: 7600,
    laborSheetRef: "БД_УСЛУГИ_РО!P920",
    draft: true,
  }),

  // iPhone 5S/SE 2016 Дисплей — пример старой ходовой модели
  buildPosition({
    id: "iphonese1.display_snyatii",
    device: "iPhone 5S / SE 2016",
    serviceName: "Замена дисплея — Снятый оригинал",
    category: "Дисплей — замена",
    variant: "Снятый оригинал",
    code: "i5S-DIS",
    warranty: "90 дней",
    laborMinutes: 30,
    sources: [
      {
        key: "icomponents",
        label: "iComponents",
        price: 1050,
        sheetRef: "БД_ЗАПЧАСТИ!I150",
      },
    ],
    markupPct: 12,
    laborPrice: 800,
    laborSheetRef: "БД_УСЛУГИ_РО!P61",
    competitorPrice: 2500,
    competitorSheetRef: "РЕМОНТ_ЯБЛОК",
    partRetailSheetRef: "БД_ЗАПЧАСТИ!P150",
    priceListSheetRef: "ПРАЙС_ЛИСТ!F127",
  }),
];

// Группировка по устройству для левой панели.
export type CatalogGroup = {
  device: string;
  positions: Position[];
};

export function groupCatalog(catalog: Position[]): CatalogGroup[] {
  const map = new Map<string, Position[]>();
  for (const p of catalog) {
    if (!map.has(p.device)) map.set(p.device, []);
    map.get(p.device)!.push(p);
  }
  return Array.from(map.entries()).map(([device, positions]) => ({
    device,
    positions,
  }));
}
