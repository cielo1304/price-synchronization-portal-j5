import { PortalShell } from "@/components/portal/portal-shell";
import { CATALOG_INDEX } from "@/lib/portal-catalog";

// По умолчанию показываем самую популярную позицию: iPhone 16, замена дисплея,
// Снятый оригинал (бу) — это строка 1167 в ПРАЙС_ЛИСТ.
const DEFAULT_ID = "iphone-16.1167";

export default function Page() {
  return (
    <div className="min-h-screen bg-background">
      <PortalShell index={CATALOG_INDEX} defaultPositionId={DEFAULT_ID} />
    </div>
  );
}
