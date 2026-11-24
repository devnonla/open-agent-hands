import { Card, Icon, Tag } from "devnonla-ui";
import type { StorageSpace } from "src/common/types";
import { FeatureIcon } from "src/components/FeatureIcon";
import { formatBytes } from "../common/format";
import { KindBar } from "./KindBar";
import { CARD_HOVER } from "src/components/card-hover";

export function SpaceCard({ space, onOpen }: { space: StorageSpace; onOpen: () => void }) {
  const folders = space.folderCount ?? 0;
  const counts = [`${space.fileCount} ${space.fileCount === 1 ? "file" : "files"}`, folders ? `${folders} ${folders === 1 ? "folder" : "folders"}` : null].filter(Boolean).join(" · ");

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open ${space.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`h-full cursor-pointer text-left outline-none [&>div]:flex-1 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${CARD_HOVER}`}
    >
      <div className="flex h-full min-h-44 flex-col">
        <div className="flex items-start gap-3 p-5">
          <FeatureIcon name="storage" size={36} variant="sticker" />
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-lg leading-7 font-semibold text-foreground">{space.name}</h2>
            {space.description ? <p className="mt-0.5 mb-0 line-clamp-2 text-sm text-muted-foreground">{space.description}</p> : null}
          </div>
          {space.isPublic ? (
            <Tag className="shrink-0">
              <span className="inline-flex items-center gap-1">
                <Icon name="globe" size={12} />
                Public
              </span>
            </Tag>
          ) : null}
        </div>

        <div className="mt-auto flex flex-col gap-3 rounded-b-xl border-t border-border bg-background px-5 pt-4 pb-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-2xl leading-7 font-semibold text-foreground tabular-nums">{formatBytes(space.totalBytes)}</span>
            <span className="truncate text-xs text-muted-foreground tabular-nums">{counts}</span>
          </div>
          <KindBar bytesByKind={space.bytesByKind} totalBytes={space.totalBytes} />
        </div>
      </div>
    </Card>
  );
}
