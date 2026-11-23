import { Card, Icon, Tag } from "devnonla-ui";
import type { StorageSpace } from "src/common/types";
import { FeatureIcon } from "src/components/FeatureIcon";
import { formatBytes } from "../common/format";
import { STORAGE_KINDS } from "../common/kinds";
import { KindPie } from "./KindPie";

export function SpaceCard({ space, onOpen }: { space: StorageSpace; onOpen: () => void }) {
  const folders = space.folderCount ?? 0;
  const counts = [`${space.fileCount} ${space.fileCount === 1 ? "file" : "files"}`, folders ? `${folders} ${folders === 1 ? "folder" : "folders"}` : null].filter(Boolean).join(" · ");
  const kinds = STORAGE_KINDS.map((kind) => ({ ...kind, bytes: space.bytesByKind?.[kind.key] ?? 0 })).filter((kind) => kind.bytes > 0);

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
      className="group cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-xl px-5 py-4 transition-colors duration-200 group-hover:bg-muted items-start @min-[520px]:grid-cols-[minmax(0,1fr)_9rem] @min-[800px]:grid-cols-[minmax(0,1.1fr)_9rem_minmax(0,1.4fr)]">
        <div className="flex min-w-0 items-start gap-3">
          <FeatureIcon name="storage" size={28} variant="sticker" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="m-0 truncate text-base font-semibold text-foreground">{space.name}</h2>
              {space.isPublic ? (
                <Tag className="shrink-0">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="globe" size={12} />
                    Public
                  </span>
                </Tag>
              ) : null}
            </div>
            {space.description ? <p className="mt-0.5 mb-0 line-clamp-2 text-sm text-muted-foreground">{space.description}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-2xl leading-7 font-semibold text-foreground">{formatBytes(space.totalBytes)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{counts}</span>
        </div>

        <div className="flex min-w-0 items-center gap-4 @min-[520px]:col-span-2 @min-[800px]:col-span-1">
          <KindPie bytesByKind={space.bytesByKind} totalBytes={space.totalBytes} />
          {kinds.length ? (
            <ul className="m-0 flex min-w-0 list-none flex-col gap-1 p-0">
              {kinds.map((kind) => (
                <li key={kind.key} className="flex items-center gap-1.5 text-xs">
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: kind.color }} />
                  <span className="text-muted-foreground">{kind.label}</span>
                  <span className="text-foreground tabular-nums">{formatBytes(kind.bytes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted-foreground">Empty</span>
          )}
        </div>
      </div>
    </Card>
  );
}
