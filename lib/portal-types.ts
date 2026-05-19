// Типы для прайс-портала.
// Каждая ценовая величина — это "ячейка" со своим адресом.
// Адрес — это путь через точку: device.position.stage.field
// Например: iphone16.display_orig_used.part.sources.icomponents

export type CellKind =
  | "source" // данные из внешнего парсера/поставщика
  | "auto" // автоматически выбирается из источников (например, MAX)
  | "manual" // ручной ввод (наценка, цена работы)
  | "formula" // вычисляемое значение по формуле
  | "output"; // выгрузка во внешнюю систему

export type Cell = {
  /** Уникальный адрес ячейки в портале. Можно дёрнуть из любой системы. */
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
  /** Привязка к ячейке исходной Google-таблицы, например "БД_УСЛУГИ_РО!P916". */
  sheetRef?: string;
  /** Жёлтое предупреждение поверх ячейки — на видном месте */
  warning?: string;
  /**
   * Если ячейка должна сравниваться с одноимённой записью в Remonline —
   * описываем что и где искать. Точное значение из РО подтянется на клиенте
   * через snapshot, синхронизация — кнопкой на ячейке.
   */
  roMatch?: {
    /** Что именно сравниваем с РО */
    kind:
      | "service-price"
      | "service-duration"
      | "part-retail"
      | "part-purchase";
    /** Нормализованное имя услуги/запчасти, по которому ищем в snapshot */
    key: string;
    /**
     * Артикул запчасти (он же partId в исходной таблице, формат «49462 586»).
     * Для part-* заполняется из JSON и используется как ЖЕЛЕЗНАЯ привязка к
     * товару в Remonline — без него остаток искать нельзя.
     * Для service-* всегда null.
     */
    partId?: string | null;
  };
};

export type Stage = {
  id: string;
  title: string;
  subtitle?: string;
  cells: Cell[];
  /** Можно ли добавлять ячейки через "+" */
  canAdd?: boolean;
  /** Стадия-заглушка: место зарезервировано, но реально не используется */
  placeholder?: boolean;
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
  /** Полное название услуги (например "Замена дисплея — Снятый оригинал (бу)") */
  serviceName: string;
  category: string;
  variant: string;
  /** Полный код услуги в Ремонлайне, например "i16-DIS" */
  code: string;
  /** Гарантия */
  warranty: string;
  /** Время работы в минутах */
  laborMinutes: number;
  stages: Stage[];
  outputs: Output[];
  /** Помечает позицию как черновик */
  draft?: boolean;
  /**
   * Жёлтое предупреждение в шапке позиции — когда у услуги нет запчасти,
   * но это не диагностика/чистка/профилактика. Видно сразу под ценой.
   */
  noPartWarning?: string;
};

/**
 * Лёгкий "заголовок" позиции для каталога-навигатора.
 * Не содержит stages/outputs — только то, что нужно для рендера списка.
 * Полную структуру строит getPositionById(id) лениво.
 */
export type PositionStub = {
  id: string;
  device: string;
  family: string;
  category: string;
  variant: string;
  code: string | null;
  finalPrice: number | null;
  warranty: string;
  draft?: boolean;
  /** Нормализованное имя услуги в РО — для быстрой проверки конфликтов в каталоге */
  roServiceKey?: string;
  /** Нормализованное имя запчасти в РО */
  roPartKey?: string;
};
