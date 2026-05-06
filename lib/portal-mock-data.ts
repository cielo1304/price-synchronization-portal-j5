import type { Position } from "./portal-types";

// Живой пример — iPhone 16, замена дисплея, оригинал.
// Данные сделаны по логике из текущей таблицы:
// 1) парсятся цены у iComponents и MOS-LCD
// 2) берётся максимум — это закупочная цена
// 3) добавляется наценка %
// 4) округление до 50 ₽ — розничная цена запчасти
// 5) к ней прибавляется стоимость работы
// 6) получается конечная цена услуги
// 7) разлетается на сайт, в МойСклад и Ремонлайн

export const iphone16DisplayOriginal: Position = {
  id: "iphone16.display_orig",
  device: "iPhone 16",
  category: "Дисплей",
  variant: "Оригинал",
  code: "DSP-IP16-ORIG",
  warranty: "180 дней",
  laborMinutes: 40,
  stages: [
    {
      id: "sources",
      title: "Источники цен",
      subtitle: "Парсеры поставщиков запчасти",
      canAdd: true,
      cells: [
        {
          address: "iphone16.display_orig.part.sources.icomponents",
          label: "iComponents",
          kind: "source",
          value: 18500,
          unit: "₽",
          source: "parser:icomponents.ru",
          note: "Обновляется каждые 6 часов",
        },
        {
          address: "iphone16.display_orig.part.sources.moslcd",
          label: "MOS-LCD",
          kind: "source",
          value: 17900,
          unit: "₽",
          source: "parser:mos-lcd.ru",
          note: "Обновляется каждые 6 часов",
        },
      ],
    },
    {
      id: "purchase",
      title: "Закупочная",
      subtitle: "Берём максимум, чтобы не уйти в минус",
      cells: [
        {
          address: "iphone16.display_orig.part.purchase_price",
          label: "Закупка",
          kind: "auto",
          value: 18500,
          unit: "₽",
          formula: "MAX(sources)",
          dependsOn: [
            "iphone16.display_orig.part.sources.icomponents",
            "iphone16.display_orig.part.sources.moslcd",
          ],
        },
      ],
    },
    {
      id: "markup",
      title: "Наценка",
      subtitle: "Сколько зарабатываем сверху",
      cells: [
        {
          address: "iphone16.display_orig.part.markup_pct",
          label: "Наценка",
          kind: "manual",
          value: 12,
          unit: "%",
          source: "Установлено вручную",
          note: "По умолчанию 12% для оригиналов",
        },
      ],
    },
    {
      id: "part_retail",
      title: "Цена запчасти",
      subtitle: "Округляется до 50 ₽",
      cells: [
        {
          address: "iphone16.display_orig.part.retail_price",
          label: "Розница запчасти",
          kind: "formula",
          value: 20750,
          unit: "₽",
          formula: "CEIL(purchase × (1 + markup), 50)",
          dependsOn: [
            "iphone16.display_orig.part.purchase_price",
            "iphone16.display_orig.part.markup_pct",
          ],
        },
      ],
    },
    {
      id: "labor",
      title: "Работа",
      subtitle: "Стоимость замены",
      cells: [
        {
          address: "iphone16.display_orig.labor.price",
          label: "Стоимость работы",
          kind: "manual",
          value: 2000,
          unit: "₽",
          source: "Установлено вручную",
          note: "По прайсу мастеров",
        },
      ],
    },
    {
      id: "final",
      title: "Конечная цена",
      subtitle: "Запчасть + работа",
      cells: [
        {
          address: "iphone16.display_orig.service.final_price",
          label: "Цена услуги",
          kind: "formula",
          value: 22750,
          unit: "₽",
          formula: "part.retail_price + labor.price",
          dependsOn: [
            "iphone16.display_orig.part.retail_price",
            "iphone16.display_orig.labor.price",
          ],
          isFinal: true,
        },
      ],
    },
  ],
  outputs: [
    {
      id: "site",
      name: "maxmobiles.ru",
      description: "Карточка услуги на сайте",
      status: "synced",
      lastSyncedAt: "2 минуты назад",
      fields: [
        {
          label: "Цена",
          fromAddress: "iphone16.display_orig.service.final_price",
          value: 22750,
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
          fromAddress: "iphone16.display_orig.service.final_price",
          value: 22750,
          unit: "₽",
        },
      ],
    },
    {
      id: "remonline",
      name: "Ремонлайн (roapp.io)",
      description: "Запчасть + работа отдельно",
      status: "synced",
      lastSyncedAt: "5 минут назад",
      fields: [
        {
          label: "Закупочная запчасти",
          fromAddress: "iphone16.display_orig.part.purchase_price",
          value: 18500,
          unit: "₽",
        },
        {
          label: "Розница запчасти",
          fromAddress: "iphone16.display_orig.part.retail_price",
          value: 20750,
          unit: "₽",
        },
        {
          label: "Работа",
          fromAddress: "iphone16.display_orig.labor.price",
          value: 2000,
          unit: "₽",
        },
      ],
    },
  ],
};
