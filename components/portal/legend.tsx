import { Database, Cpu, Pencil, Sigma, ArrowDownToLine } from "lucide-react";

const ITEMS = [
  {
    label: "Источник",
    description: "Парсер поставщика",
    icon: Database,
    className: "text-muted-foreground",
  },
  {
    label: "Авто",
    description: "Выбор по правилу (MAX и т.п.)",
    icon: Cpu,
    className: "text-flow",
  },
  {
    label: "Ручной ввод",
    description: "Заполняет менеджер",
    icon: Pencil,
    className: "text-foreground",
    dashed: true,
  },
  {
    label: "Формула",
    description: "Вычисляется автоматически",
    icon: Sigma,
    className: "text-flow",
  },
  {
    label: "Выгрузка",
    description: "Уходит в Сайт / МС / РО",
    icon: ArrowDownToLine,
    className: "text-money",
  },
];

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card/60 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Типы ячеек:
      </div>
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="flex items-center gap-1.5">
            <Icon className={`h-3.5 w-3.5 ${item.className}`} />
            <span className="text-xs font-medium text-foreground">{item.label}</span>
            <span className="text-xs text-muted-foreground">— {item.description}</span>
          </div>
        );
      })}
    </div>
  );
}
