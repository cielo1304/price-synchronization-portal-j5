// Типы для прайс-портала.
// Каждая ценовая величина — это "ячейка" со своим адресом.
// Адрес — это путь через точку: device.position.stage.field
// Например: iphone16.display_orig.part.sources.icomponents.price

export type CellKind =
  | "source" // данные из внешнего парсера/поставщика
  | "auto" // автоматически выбирается из источников (например, MAX)
  | "manual" // ручной ввод (наценка, цена работы)
  | "formula" // вычисляемое значение по формуле
  | "output"; // выгрузка во внешнюю систему

export type Cell = {
  /** Уникальный адрес ячейки. Можно дёрнуть из любой системы. */
  address: string;
  /** Человекочитаемое название */
  label: string;
  /** Тип ячейки — от него зависит цвет и поведение */
  kind: CellKind;
  /** Значение */
  value: number | null;
  /** Единица измерения. По умолчанию ₽ */
  unit?: "₽" | "%" | "min";
  /** Откуда пришли данные — парсер, формула, ручной ввод */
  source?: string;
  /** Если formula — текст формулы для отображения */
  formula?: string;
  /** Адреса ячеек, от которых эта ячейка зависит */
  dependsOn?: string[];
  /** Заметка/комментарий для менеджера */
  note?: string;
  /** Ярко выделить как итоговую */
  isFinal?: boolean;
};

export type Stage = {
  id: string;
  title: string;
  subtitle?: string;
  cells: Cell[];
  /** Можно ли добавлять ячейки через "+" */
  canAdd?: boolean;
};

export type Output = {
  id: "site" | "moysklad" | "remonline";
  name: string;
  description: string;
  /** Куда мапятся данные в этой внешней системе */
  fields: Array<{
    label: string;
    fromAddress: string;
    value: number;
    unit?: "₽";
  }>;
  status: "synced" | "pending" | "error";
  lastSyncedAt?: string;
};

export type Position = {
  id: string;
  device: string;
  category: string;
  variant: string;
  /** Полный код позиции в РО */
  code: string;
  /** Гарантия */
  warranty: string;
  /** Время работы */
  laborMinutes: number;
  stages: Stage[];
  outputs: Output[];
};
