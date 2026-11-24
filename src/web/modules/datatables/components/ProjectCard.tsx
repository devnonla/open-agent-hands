import { Card, Tag } from "devnonla-ui";
import { FeatureIcon } from "src/components/FeatureIcon";
import RenderIf from "src/components/RenderIf";
import type { DatatableProjectListItem } from "../common/datatableProjectsSlice";
import { CARD_HOVER } from "src/components/card-hover";

export function ProjectCard({ project, onOpen }: { project: DatatableProjectListItem; onOpen: () => void }) {
  const names = project.tableNames ?? [];
  const shown = names.slice(0, 4);
  const extra = names.length - shown.length;
  const count = project.tableCount ?? names.length;

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open ${project.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`h-full cursor-pointer text-left [&>div]:flex-1 ${CARD_HOVER}`}
    >
      <div className="flex min-h-40 flex-col p-5">
        <FeatureIcon name="datatables" size={28} variant="sticker" />
        <h2 className="mt-4 mb-0 truncate text-lg font-semibold text-foreground">{project.name}</h2>
        <p className="mt-1 mb-0 text-sm text-muted-foreground">
          {count} {count === 1 ? "table" : "tables"}
        </p>
        <div className="mt-3 flex min-h-6 flex-wrap gap-1">
          <RenderIf condition={shown.length > 0} fallback={<span className="text-xs text-muted-foreground">No tables yet</span>}>
            {shown.map((name) => (
              <Tag key={name}>{name}</Tag>
            ))}
            {extra > 0 ? <Tag>+{extra}</Tag> : null}
          </RenderIf>
        </div>
      </div>
    </Card>
  );
}
