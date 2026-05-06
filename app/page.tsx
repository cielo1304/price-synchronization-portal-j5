import { PortalShell } from "@/components/portal/portal-shell";
import { iphone16DisplayOriginal } from "@/lib/portal-mock-data";

export default function Page() {
  return (
    <div className="min-h-screen bg-background">
      <PortalShell position={iphone16DisplayOriginal} />
    </div>
  );
}
