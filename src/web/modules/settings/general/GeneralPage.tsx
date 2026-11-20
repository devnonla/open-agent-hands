import { SandboxSection } from "./components/SandboxSection";
import { TimezoneSection } from "./components/TimezoneSection";

export function GeneralPage() {
  return (
    <div className="flex flex-col gap-6">
      <TimezoneSection />
      <SandboxSection />
    </div>
  );
}
