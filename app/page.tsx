import { PortalShell } from "@/components/portal/portal-shell";
import { CATALOG } from "@/lib/portal-catalog";

export default function Page() {
  return (
    <div className="min-h-screen bg-background">
      <PortalShell catalog={CATALOG} defaultPositionId="iphone16.display_orig_used" />
    </div>
  );
}
