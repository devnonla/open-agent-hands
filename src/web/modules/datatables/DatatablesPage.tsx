import { Button, Empty, message } from "devnonla-ui";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DatatableProject } from "src/common/types";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { type DatatableProjectListItem, fetchDatatableProjects } from "./common/datatableProjectsSlice";
import { ProjectCard } from "./components/ProjectCard";
import { ProjectDialog } from "./components/ProjectDialog";

export default function DatatablesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const items = useAppSelector((s) => s.datatableProjects.items) as DatatableProjectListItem[];
  const [loading, setLoading] = useState(items.length === 0);
  const [creating, setCreating] = useState(false);

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
    <PageShell>
      <PageHeader
        title="Datatables"
        icon="datatables"
        actions={
          <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />

      <RenderIf condition={loading && items.length === 0}>
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 @min-[900px]:grid-cols-3">
            {["a", "b", "c"].map((key) => (
              <div key={key} className="h-40 animate-pulse rounded-2xl border border-border-subtle bg-muted/50" />
            ))}
          </div>
        </div>
      </RenderIf>

      <RenderIf condition={!loading && items.length === 0}>
        <Empty className="rounded-2xl border border-dashed border-border px-5 py-16" description="No projects yet">
          <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            New project
          </Button>
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

      {creating ? (
        <ProjectDialog
          onClose={() => setCreating(false)}
          onSaved={(saved: DatatableProject) => {
            navigate(`/datatables/${saved.id}`);
          }}
        />
      ) : null}
    </PageShell>
  );
}
