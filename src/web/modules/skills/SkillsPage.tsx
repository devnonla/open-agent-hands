import { Empty, Modal, SearchInput, message } from "devnonla-ui";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Skill } from "src/common/types";
import { MissingProviderCallout } from "src/components/MissingProviderCallout";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { deleteSkillFolder, fetchSkillFolders } from "./common/skillFoldersSlice";
import type { SkillFolderWithSkills } from "./common/skillFoldersSlice";
import { deleteSkill, fetchSkills, updateSkill, updateSkillLocal } from "./common/skillsSlice";
import { NewSkillDialog } from "./components/NewSkillDialog";
import { NewFolderPopover, SkillFolderDialog } from "./components/SkillFolderDialog";
import { SkillsBoard } from "./components/SkillsBoard";
import { SkillsEmptyState } from "./components/SkillsEmptyState";

export default function SkillsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const items = useAppSelector((s) => s.skills.items) as Skill[];
  const folders = useAppSelector((s) => s.skillFolders.folders) as SkillFolderWithSkills[];
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(items.length === 0 && folders.length === 0);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [editingFolder, setEditingFolder] = useState<SkillFolderWithSkills | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all([dispatch(fetchSkills()).unwrap(), dispatch(fetchSkillFolders()).unwrap()]);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((skill) => skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q));
  }, [items, query]);

  const searching = query.trim().length > 0;
  const showBoard = !loading && (filtered.length > 0 || (folders.length > 0 && !searching));

  const handleMove = async (skill: Skill, folderId: string | null) => {
    const next = folderId ?? null;
    const current = skill.folderId ?? null;
    if (next === current) return;
    dispatch(updateSkillLocal({ id: skill.id, folderId: next }));
    try {
      await dispatch(updateSkill({ id: skill.id, folderId: next })).unwrap();
    } catch (err: unknown) {
      dispatch(updateSkillLocal({ id: skill.id, folderId: current }));
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteFolder = async (folder: SkillFolderWithSkills) => {
    try {
      await dispatch(deleteSkillFolder(folder.id)).unwrap();
      for (const skill of items) {
        if (skill.folderId === folder.id) dispatch(updateSkillLocal({ id: skill.id, folderId: null }));
      }
      message.success("Folder deleted");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <PageShell>
        <MissingProviderCallout />
        <PageHeader
          title="Skills"
          icon="skills"
          actions={
            <>
              <RenderIf condition={items.length > 0}>
                <SearchInput placeholder="Search skills…" className="w-52" onChange={setQuery} />
              </RenderIf>
              <NewFolderPopover />
              <NewSkillDialog />
            </>
          }
        />

        <RenderIf condition={items.length === 0 && folders.length === 0 && !loading}>
          <SkillsEmptyState>
            <NewSkillDialog />
          </SkillsEmptyState>
        </RenderIf>

        <RenderIf condition={items.length > 0 && filtered.length === 0}>
          <Empty className="rounded-2xl border border-dashed border-border-subtle bg-card/50 py-12" description="No matches" />
        </RenderIf>

        <RenderIf condition={loading && items.length === 0 && folders.length === 0}>
          <div className="grid grid-cols-2 gap-3">
            {["a", "b", "c", "d"].map((key) => (
              <div key={key} className="h-24 animate-pulse rounded-xl border border-border-subtle bg-card/70 px-4 py-3.5">
                <div className="flex gap-3">
                  <div className="size-11 rounded-lg bg-muted" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-4 w-1/3 rounded bg-muted" />
                    <div className="h-3 w-2/3 rounded bg-muted/70" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </RenderIf>

        <RenderIf condition={showBoard}>
          <SkillsBoard skills={filtered} folders={folders} searching={searching} onOpen={(skill) => navigate(`/skills/${skill.id}`)} onDelete={setDeleting} onMove={(skill, folderId) => void handleMove(skill, folderId)} onEditFolder={setEditingFolder} onDeleteFolder={(folder) => void handleDeleteFolder(folder)} />
        </RenderIf>

        <Modal
          open={!!deleting}
          title={deleting ? `Delete ${deleting.name}?` : "Delete skill?"}
          okText="Delete"
          okButtonProps={{ danger: true }}
          destroyOnHidden
          onCancel={() => setDeleting(null)}
          onOk={async () => {
            if (!deleting) return;
            try {
              await dispatch(deleteSkill(deleting.id)).unwrap();
              message.success("Deleted");
              setDeleting(null);
            } catch (err: unknown) {
              message.error(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <p className="m-0 text-sm text-muted-foreground">This cannot be undone.</p>
        </Modal>
      </PageShell>

      <SkillFolderDialog open={!!editingFolder} onClose={() => setEditingFolder(null)} folder={editingFolder} />
    </>
  );
}
