import { PortalShell } from "@/components/portal/portal-shell";
import { CATALOG_INDEX } from "@/lib/portal-catalog";

// По умолчанию показываем самую популярную позицию: iPhone 16, замена дисплея,
// Снятый оригинал (бу) — это строка 1167 в ПРАЙС_ЛИСТ.
const DEFAULT_ID =
  "iphone_16__дисплей_замена_на_снятый_оригинал_бу__r1167";

export default function Page() {
  return (
    <div className="min-h-screen bg-background">
      <PortalShell index={CATALOG_INDEX} defaultPositionId={DEFAULT_ID} />
    </div>
  );
}
