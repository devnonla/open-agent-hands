import { Card, type IconName } from "devnonla-ui";
import { useEffect, useState } from "react";
import type { Site } from "src/common/types";
import { FeatureIcon } from "src/components/FeatureIcon";
import RenderIf from "src/components/RenderIf";
import { sitesApi } from "../common/sitesApi";

export type SiteVisibility = "unpublished" | "protected" | "public";

export function siteVisibility(site: Site): SiteVisibility {
  if (!site.isPublished) return "unpublished";
  if (site.hasPublicPassword) return "protected";
  return "public";
}

export const SITE_VISIBILITY_META: Record<SiteVisibility, { label: string; description: string; icon: IconName }> = {
  unpublished: {
    label: "Private",
    description: "Not shared. Only you can open it here in the app.",
    icon: "pen",
  },
  protected: {
    label: "Protected",
    description: "Published with a password. Visitors must unlock to view.",
    icon: "shield-check",
  },
  public: {
    label: "Public",
    description: "Anyone with the link can view this site.",
    icon: "globe",
  },
};

async function cropToOpaque(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const source = document.createElement("canvas");
  source.width = bitmap.width;
  source.height = bitmap.height;
  const ctx = source.getContext("2d");
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data, width, height } = ctx.getImageData(0, 0, source.width, source.height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 12) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return blob;

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  if (cropW === width && cropH === height) return blob;

  const out = document.createElement("canvas");
  out.width = cropW;
  out.height = cropH;
  out.getContext("2d")?.drawImage(source, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
  const cropped = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  return cropped ?? blob;
}

function SiteThumbnail({ site }: { site: Site }) {
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setThumbFailed(false);
    setThumbSrc(null);

    void sitesApi
      .getThumbnail(site.id)
      .then((blob) => cropToOpaque(blob))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setThumbFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [site.id, site.draftUpdatedAt, site.updatedAt]);

  return (
    <div className="relative m-1.5 aspect-16/10 overflow-hidden rounded-lg bg-muted">
      <RenderIf
        condition={!!thumbSrc && !thumbFailed}
        fallback={
          <div className="flex h-full w-full items-center justify-center">
            <FeatureIcon name="sites" size={28} variant="sticker" />
          </div>
        }
      >
        <img src={thumbSrc ?? undefined} alt="" draggable={false} className="absolute inset-0 h-full w-full" style={{ objectFit: "cover", objectPosition: "top center" }} />
      </RenderIf>
    </div>
  );
}

export function SiteCard({ site, onOpen }: { site: Site; onOpen: () => void }) {
  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={`Open ${site.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onOpen();
      }}
      className="min-w-0 cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-focus-ring"
    >
      <SiteThumbnail site={site} />
      <div className="truncate px-3 pt-1 pb-2.5 text-sm font-medium text-foreground">{site.name}</div>
    </Card>
  );
}
