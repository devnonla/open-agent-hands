import connectIcon from "src/assets/feature-icons/connect.svg";
import datatablesIcon from "src/assets/feature-icons/datatables.svg";
import jobsIcon from "src/assets/feature-icons/jobs.svg";
import kvStoreIcon from "src/assets/feature-icons/kv-store.svg";
import mcpIcon from "src/assets/feature-icons/mcp.svg";
import secretsIcon from "src/assets/feature-icons/secrets.svg";
import settingsIcon from "src/assets/feature-icons/settings.svg";
import sitesIcon from "src/assets/feature-icons/sites.svg";
import storageIcon from "src/assets/feature-icons/storage.svg";
import toolsIcon from "src/assets/feature-icons/tools.svg";
import { cn } from "src/common/lib/cn";

const FEATURE_ICONS = {
  connect: connectIcon,
  tools: toolsIcon,
  jobs: jobsIcon,
  mcp: mcpIcon,
  datatables: datatablesIcon,
  "kv-store": kvStoreIcon,
  secrets: secretsIcon,
  settings: settingsIcon,
  sites: sitesIcon,
  storage: storageIcon,
} as const;

export type FeatureIconName = keyof typeof FEATURE_ICONS;
export type FeatureIconVariant = "plain" | "sticker";

/** Hard white rim around the icon alpha, then a separate soft shadow on the wrapper. */
function stickerRim(size: number): string {
  const w = Math.round(Math.max(0.45, size * 0.03) * 10) / 10;
  const edge = (x: number, y: number) => `drop-shadow(${x}px ${y}px 0 #fff)`;
  return [edge(w, 0), edge(-w, 0), edge(0, w), edge(0, -w)].join(" ");
}

/** Color mark for an app feature. Decorative when a text label sits beside it. */
export function FeatureIcon({ name, size = 24, variant = "plain", className }: { name: FeatureIconName; size?: number; variant?: FeatureIconVariant; className?: string }) {
  const img = <img src={FEATURE_ICONS[name]} alt="" width={size} height={size} aria-hidden className={cn("inline-block max-w-none shrink-0 object-contain", className)} style={{ width: size, height: size, filter: variant === "sticker" ? stickerRim(size) : undefined }} />;

  if (variant !== "sticker") return img;

  const y = Math.max(0.5, size * 0.025);
  const blur = Math.max(1, size * 0.045);
  return (
    <span className="inline-flex shrink-0" style={{ filter: `drop-shadow(0 ${y}px ${blur}px rgb(15 23 42 / 0.12))` }}>
      {img}
    </span>
  );
}
