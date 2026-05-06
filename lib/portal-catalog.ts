import type { Position } from "./portal-types";

// Фабрика создаёт Position по простому набору параметров,
// чтобы не дублировать структуру стадий.
//
// Когда придёт реальный XLSX из Google Sheets — мы заменим
// этот каталог на сгенерированный из БД_УСЛУГИ_РО + БД_ЗАПЧАСТИ.

type PositionInput = {
  id: string;
  device: string;
  category: string;
  variant: string;
  code: string;
  warranty: string;
  laborMinutes: number;
  /** Цены поставщиков. Если пусто — позиция без запчасти (только работа) */
  sources?: Array<{ key: string; label: string; price: number; note?: string }>;
  /** Наценка % */
  markupPct?: number;
  /** Шаг округления розницы запчасти */
  roundStep?: number;
  /** Стоимость работы */
  laborPrice: number;
  /** Если позиция ещё не настроена — будет помечена "draft" */
  draft?: boolean;
};

const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;

export function buildPosition(input: PositionInput): Position {
  const {
    id,
    device,
    category,
    variant,
    code,
    warranty,
    laborMinutes,
    sources = [],
    markupPct = 0,
    roundStep = 50,
    laborPrice,
  } = input;

  const hasPart = sources.length > 0;
  const purchase = hasPart ? Math.max(...sources.map((s) => s.price)) : 0;
  const partRetail = hasPart
    ? ceilTo(purchase * (1 + markupPct / 100), roundStep)
    : 0;
  const final = partRetail + laborPrice;

  const stages: Position["stages"] = [];

  if (hasPart) {
    stages.push({
      id: "sources",
      title: "Источники цен",
      subtitle: "Парсеры поставщиков запчасти",
      canAdd: true,
      cells: sources.map((s) => ({
        address: `${id}.part.sources.${s.key}`,
        label: s.label,
        kind: "source" as const,
        value: s.price,
        unit: "₽" as const,
        source: `parser:${s.key}`,
        note: s.note ?? "Обновляется каждые 6 часов",
      })),
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
          value: purchase,
          unit: "₽",
          formula: "MAX(sources)",
          dependsOn: sources.map((s) => `${id}.part.sources.${s.key}`),
        },
      ],
    });

    stages.push({
      id: "markup",
      title: "Наценка",
      subtitle: "Сколько зарабатываем сверху",
      cells: [
        {
          address: `${id}.part.markup_pct`,
          label: "Наценка",
          kind: "manual",
          value: markupPct,
          unit: "%",
          source: "Установлено вручную",
          note: variant === "Оригинал" ? "По умолчанию для оригиналов" : undefined,
        },
      ],
    });

    stages.push({
      id: "part_retail",
      title: "Цена запчасти",
      subtitle: `Округляется до ${roundStep} ₽`,
      cells: [
        {
          address: `${id}.part.retail_price`,
          label: "Розница запчасти",
          kind: "formula",
          value: partRetail,
          unit: "₽",
          formula: `CEIL(purchase × (1 + markup), ${roundStep})`,
          dependsOn: [`${id}.part.purchase_price`, `${id}.part.markup_pct`],
        },
      ],
    });
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
        value: laborPrice,
        unit: "₽",
        source: "Установлено вручную",
        note: "По прайсу мастеров",
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
        value: final,
        unit: "₽",
        formula: hasPart
          ? "part.retail_price + labor.price"
          : "labor.price",
        dependsOn: hasPart
          ? [`${id}.part.retail_price`, `${id}.labor.price`]
          : [`${id}.labor.price`],
        isFinal: true,
      },
    ],
  });

  const outputs: Position["outputs"] = [
    {
      id: "site",
      name: "maxmobiles.ru",
      description: "Карточка услуги на сайте",
      status: "synced",
      lastSyncedAt: "2 минуты назад",
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
      description: "Карточка товара/услуги",
      status: "pending",
      lastSyncedAt: "ожидает синхронизации",
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
      name: "Ремонлайн (roapp.io)",
      description: hasPart ? "Запчасть + работа отдельно" : "Только работа",
      status: "synced",
      lastSyncedAt: "5 минут назад",
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
    category,
    variant,
    code,
    warranty,
    laborMinutes,
    stages,
    outputs,
  };
}

// Каталог. Цифры — ориентировочные, чтобы прочувствовать UX.
// При импорте XLSX заменим на реальные.
export const CATALOG: Position[] = [
  buildPosition({
    id: "iphone16.display_orig",
    device: "iPhone 16",
    category: "Дисплей",
    variant: "Оригинал",
    code: "DSP-IP16-ORIG",
    warranty: "180 дней",
    laborMinutes: 40,
    sources: [
      { key: "icomponents", label: "iComponents", price: 18500 },
      { key: "moslcd", label: "MOS-LCD", price: 17900 },
    ],
    markupPct: 12,
    laborPrice: 2000,
  }),
  buildPosition({
    id: "iphone16.display_copy",
    device: "iPhone 16",
    category: "Дисплей",
    variant: "Копия (Аналог)",
    code: "DSP-IP16-COPY",
    warranty: "90 дней",
    laborMinutes: 40,
    sources: [
      { key: "icomponents", label: "iComponents", price: 7900 },
      { key: "moslcd", label: "MOS-LCD", price: 7600 },
    ],
    markupPct: 35,
    laborPrice: 2000,
  }),
  buildPosition({
    id: "iphone16.battery",
    device: "iPhone 16",
    category: "Аккумулятор",
    variant: "Оригинал",
    code: "BAT-IP16-ORIG",
    warranty: "180 дней",
    laborMinutes: 25,
    sources: [
      { key: "icomponents", label: "iComponents", price: 3400 },
      { key: "moslcd", label: "MOS-LCD", price: 3200 },
    ],
    markupPct: 20,
    laborPrice: 1500,
  }),
  buildPosition({
    id: "iphone16.back_glass",
    device: "iPhone 16",
    category: "Заднее стекло",
    variant: "Оригинал",
    code: "BG-IP16",
    warranty: "90 дней",
    laborMinutes: 60,
    sources: [{ key: "icomponents", label: "iComponents", price: 2400 }],
    markupPct: 25,
    laborPrice: 2500,
  }),
  buildPosition({
    id: "iphone16.camera_main",
    device: "iPhone 16",
    category: "Основная камера",
    variant: "Оригинал",
    code: "CAM-IP16",
    warranty: "90 дней",
    laborMinutes: 30,
    sources: [{ key: "icomponents", label: "iComponents", price: 6800 }],
    markupPct: 20,
    laborPrice: 1800,
    draft: true,
  }),
  buildPosition({
    id: "iphone15pro.display_orig",
    device: "iPhone 15 Pro",
    category: "Дисплей",
    variant: "Оригинал",
    code: "DSP-IP15P-ORIG",
    warranty: "180 дней",
    laborMinutes: 45,
    sources: [
      { key: "icomponents", label: "iComponents", price: 16500 },
      { key: "moslcd", label: "MOS-LCD", price: 16200 },
    ],
    markupPct: 12,
    laborPrice: 2000,
  }),
  buildPosition({
    id: "iphone15pro.battery",
    device: "iPhone 15 Pro",
    category: "Аккумулятор",
    variant: "Оригинал",
    code: "BAT-IP15P",
    warranty: "180 дней",
    laborMinutes: 25,
    sources: [{ key: "icomponents", label: "iComponents", price: 2900 }],
    markupPct: 20,
    laborPrice: 1500,
  }),
  buildPosition({
    id: "iphone14.display_copy",
    device: "iPhone 14",
    category: "Дисплей",
    variant: "Копия",
    code: "DSP-IP14-COPY",
    warranty: "90 дней",
    laborMinutes: 35,
    sources: [
      { key: "icomponents", label: "iComponents", price: 5400 },
      { key: "moslcd", label: "MOS-LCD", price: 5100 },
    ],
    markupPct: 35,
    laborPrice: 1800,
  }),
  buildPosition({
    id: "iphone5.battery",
    device: "iPhone 5",
    category: "Аккумулятор",
    variant: "Аналог ORIG",
    code: "BAT-IP5",
    warranty: "180 дней",
    laborMinutes: 20,
    sources: [
      { key: "icomponents", label: "iComponents", price: 430 },
      { key: "moslcd", label: "MOS-LCD", price: 340 },
    ],
    markupPct: 12,
    laborPrice: 800,
  }),
  buildPosition({
    id: "ipad.diagnostics",
    device: "iPad",
    category: "Диагностика",
    variant: "Стандарт",
    code: "DIAG-IPAD",
    warranty: "—",
    laborMinutes: 30,
    laborPrice: 500,
  }),
];

export const CATALOG_DRAFTS = new Set(
  CATALOG.filter((p) => false).map((p) => p.id),
);

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
