import { FeatureIcon } from "src/components/FeatureIcon";
import RenderIf from "src/components/RenderIf";
import type { DatatableProjectListItem } from "../common/datatableProjectsSlice";

export function ProjectCard({ project, onOpen }: { project: DatatableProjectListItem; onOpen: () => void }) {
  const names = project.tableNames ?? [];
  const shown = names.slice(0, 4);
  const extra = names.length - shown.length;
  const count = project.tableCount ?? names.length;

  return (
    <div
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
      className="group flex min-h-40 cursor-pointer flex-col rounded-2xl border border-border-subtle bg-card p-5 text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-secondary"
    >
      <FeatureIcon name="datatables" size={28} variant="sticker" />
      <h2 className="mt-4 mb-0 truncate text-lg font-semibold text-foreground">{project.name}</h2>
      <p className="mt-1 mb-0 text-sm text-muted-foreground">
        {count} {count === 1 ? "table" : "tables"}
      </p>
      <div className="mt-3 flex min-h-6 flex-wrap gap-1">
        <RenderIf condition={shown.length > 0} fallback={<span className="text-xs text-muted-foreground">No tables yet</span>}>
          {shown.map((name) => (
            <span key={name} className="max-w-full truncate rounded-md border border-border bg-background px-1.5 py-0.5 text-xs leading-4 text-muted-foreground">
              {name}
            </span>
          ))}
          {extra > 0 ? <span className="rounded-md px-1.5 py-0.5 text-xs leading-4 text-muted-foreground">+{extra}</span> : null}
        </RenderIf>
      </div>
    </div>
  );
}
