import { Card, Empty, Skeleton, message } from "devnonla-ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { type DatatableProjectListItem, fetchDatatableProjects } from "./common/datatableProjectsSlice";
import { ProjectCard } from "./components/ProjectCard";

export default function DatatablesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const items = useAppSelector((s) => s.datatableProjects.items) as DatatableProjectListItem[];
  const [loading, setLoading] = useState(items.length === 0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await dispatch(fetchDatatableProjects()).unwrap();
      } catch (err: unknown) {
        if (!cancelled) message.error(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  return (
    <PageShell header={<PageHeader title="Datatables" icon="datatables" description="Tables your agents build. Browse and edit rows here." className="mb-0 pb-0" bordered={false} />}>
      <RenderIf condition={loading && items.length === 0}>
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 @min-[900px]:grid-cols-3">
            {["a", "b", "c"].map((key) => (
              <Card key={key}>
                <div className="flex min-h-40 flex-col gap-4 p-5">
                  <Skeleton.Input className="size-7" />
                  <Skeleton paragraph={{ rows: 2 }} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </RenderIf>

      <RenderIf condition={!loading && items.length === 0}>
        <Empty className="py-16" description="No projects yet">
          <AskClaudeHint what="datatable project" tool="datatable_create_project" />
        </Empty>
      </RenderIf>

      <RenderIf condition={items.length > 0}>
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 @min-[900px]:grid-cols-3">
            {items.map((project) => (
              <ProjectCard key={project.id} project={project} onOpen={() => navigate(`/datatables/${project.id}`)} />
            ))}
          </div>
        </div>
      </RenderIf>
    </PageShell>
  );
}
