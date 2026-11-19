import { type CollisionDetection, DndContext, type DragEndEvent, DragOverlay, type DragStartEvent, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { Button, Dropdown, Modal } from "devnonla-ui";
import type { MenuProps } from "devnonla-ui";
import { Ellipsis, Folder, Pencil, Plus, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "src/common/lib/cn";
import type { Skill } from "src/common/types";
import { BUILTIN_SKILL_FOLDER_ID, isBuiltinSkillId } from "../common/builtinSkills";
import type { SkillFolderWithSkills } from "../common/skillFoldersSlice";
import { NewSkillDialog } from "./NewSkillDialog";
import { SkillCard } from "./SkillCard";

const UNGROUPED_ID = "ungrouped";

function sortFolders(folders: SkillFolderWithSkills[]) {
  return [...folders].sort((a, b) => {
    const byOrder = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (byOrder !== 0) return byOrder;
    return a.name.localeCompare(b.name);
  });
}

function SkillGrid({
  skills,
  folders,
  dragEnabled,
  onOpen,
  onDelete,
  onMove,
}: {
  skills: Skill[];
  folders: { id: string; name: string }[];
  dragEnabled: boolean;
  onOpen: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  onMove: (skill: Skill, folderId: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {skills.map((skill) => (
        <DraggableSkillCard key={skill.id} skill={skill} folders={folders} dragEnabled={dragEnabled} onOpen={() => onOpen(skill)} onDelete={() => onDelete(skill)} onMove={(folderId) => onMove(skill, folderId)} />
      ))}
    </div>
  );
}

function DraggableSkillCard({
  skill,
  folders,
  dragEnabled,
  onOpen,
  onDelete,
  onMove,
}: {
  skill: Skill;
  folders: { id: string; name: string }[];
  dragEnabled: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const canDrag = dragEnabled && !isBuiltinSkillId(skill.id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: skill.id,
    disabled: !canDrag,
    data: { type: "skill", folderId: skill.folderId ?? null },
  });

  return (
    <div ref={setNodeRef} className={cn("min-w-0 touch-none", isDragging && "opacity-40")} {...(canDrag ? listeners : {})} {...(canDrag ? attributes : {})}>
      <SkillCard skill={skill} folders={folders} draggable={canDrag} onOpen={onOpen} onDelete={onDelete} onMove={onMove} />
    </div>
  );
}

function DropSection({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: "folder" } });
  return (
    <section ref={setNodeRef} className={cn("rounded-xl transition-colors", isOver && "bg-muted/40 ring-1 ring-border")}>
      {children}
    </section>
  );
}

function FolderMenu({ title, onEdit, onDelete }: { title: string; onEdit: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const items: MenuProps["items"] = [
    {
      key: "rename",
      label: "Rename",
      icon: <Pencil size={14} />,
      onClick: onEdit,
    },
    {
      key: "delete",
      danger: true,
      label: "Delete",
      icon: <X size={14} />,
      onClick: () => {
        Modal.confirm({
          title: `Delete "${title}"?`,
          content: "Skills in this folder move to Ungrouped.",
          okText: "Delete",
          okButtonProps: { danger: true },
          cancelText: "Cancel",
          onOk: () => onDelete(),
        });
      },
    },
  ];

  return (
    <Dropdown trigger={["click"]} placement="bottomRight" open={menuOpen} onOpenChange={setMenuOpen} menu={{ items, style: { minWidth: 160 } }}>
      <Button type="text" size="small" aria-label={`${title} actions`} className="px-1.5!" icon={<Ellipsis size={15} />} />
    </Dropdown>
  );
}

export function SkillsBoard({
  skills,
  folders,
  searching,
  onOpen,
  onDelete,
  onMove,
  onEditFolder,
  onDeleteFolder,
}: {
  skills: Skill[];
  folders: SkillFolderWithSkills[];
  searching: boolean;
  onOpen: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  onMove: (skill: Skill, folderId: string | null) => void;
  onEditFolder: (folder: SkillFolderWithSkills) => void;
  onDeleteFolder: (folder: SkillFolderWithSkills) => void;
}) {
  const ordered = sortFolders(folders);
  const folderIds = new Set(ordered.map((folder) => folder.id));
  const byFolder = new Map<string, Skill[]>();
  const ungrouped: Skill[] = [];

  for (const skill of skills) {
    if (skill.folderId && folderIds.has(skill.folderId)) {
      const list = byFolder.get(skill.folderId) ?? [];
      list.push(skill);
      byFolder.set(skill.folderId, list);
    } else {
      ungrouped.push(skill);
    }
  }

  const folderOptions = ordered.map((folder) => ({ id: folder.id, name: folder.name }));
  const visibleFolders = searching ? ordered.filter((folder) => (byFolder.get(folder.id)?.length ?? 0) > 0) : ordered;
  const userFolders = visibleFolders.filter((folder) => folder.id !== BUILTIN_SKILL_FOLDER_ID);
  const builtinFolder = visibleFolders.find((folder) => folder.id === BUILTIN_SKILL_FOLDER_ID) ?? null;
  const dragEnabled = ordered.length > 0 && !searching;
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [overlayWidth, setOverlayWidth] = useState<number | null>(null);
  const didDragRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const collisionDetection: CollisionDetection = (args) => {
    const pointerHits = pointerWithin(args);
    if (pointerHits.length > 0) return pointerHits;
    return rectIntersection(args);
  };

  const openSkill = (skill: Skill) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    onOpen(skill);
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    didDragRef.current = true;
    setActiveSkillId(String(active.id));
    setOverlayWidth(active.rect.current.initial?.width ?? null);
  };

  const clearDrag = () => {
    setActiveSkillId(null);
    setOverlayWidth(null);
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 80);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const skill = skills.find((item) => item.id === String(active.id));
    const overId = over ? String(over.id) : null;
    clearDrag();
    if (!skill || !overId || isBuiltinSkillId(skill.id)) return;

    const targetFolderId = overId === UNGROUPED_ID ? null : folderIds.has(overId) ? overId : undefined;
    if (targetFolderId === BUILTIN_SKILL_FOLDER_ID) return;
    if (targetFolderId === undefined) return;

    const current = skill.folderId && folderIds.has(skill.folderId) ? skill.folderId : null;
    if (current === targetFolderId) return;
    onMove(skill, targetFolderId);
  };

  const activeSkill = activeSkillId ? (skills.find((skill) => skill.id === activeSkillId) ?? null) : null;
  const showUngrouped = ungrouped.length > 0 || activeSkillId != null;
  const builtinSkills = builtinFolder ? (byFolder.get(builtinFolder.id) ?? []) : [];

  const grid = (items: Skill[]) => <SkillGrid skills={items} folders={folderOptions} dragEnabled={dragEnabled} onOpen={openSkill} onDelete={onDelete} onMove={onMove} />;

  if (ordered.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {skills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} folders={folderOptions} onOpen={() => onOpen(skill)} onDelete={() => onDelete(skill)} onMove={(folderId) => onMove(skill, folderId)} />
        ))}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragCancel={clearDrag} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-8">
        {userFolders.map((folder) => {
          const folderSkills = byFolder.get(folder.id) ?? [];
          return (
            <DropSection key={folder.id} id={folder.id}>
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Folder size={16} />
                    </div>
                    <h2 className="m-0 truncate text-base font-semibold text-foreground">{folder.name}</h2>
                    <span className="shrink-0 text-xs text-muted-foreground">{folderSkills.length}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <NewSkillDialog folderId={folder.id}>
                      <Button type="text" size="small" className="px-1.5!" title="Add skill to folder" aria-label={`Add skill to ${folder.name}`} icon={<Plus size={15} />} />
                    </NewSkillDialog>
                    <FolderMenu title={folder.name} onEdit={() => onEditFolder(folder)} onDelete={() => onDeleteFolder(folder)} />
                  </div>
                </div>
                {folderSkills.length > 0 ? grid(folderSkills) : <p className="m-0 rounded-xl border border-dashed border-border-subtle px-4 py-6 text-center text-sm text-muted-foreground">No skills in this folder</p>}
              </div>
            </DropSection>
          );
        })}

        {showUngrouped ? (
          <DropSection id={UNGROUPED_ID}>
            <div className="mb-3 flex items-center gap-2.5">
              <h2 className="m-0 text-base font-semibold text-foreground">Ungrouped</h2>
              <span className="text-xs text-muted-foreground">{ungrouped.length}</span>
            </div>
            {ungrouped.length > 0 ? grid(ungrouped) : <p className="m-0 rounded-xl border border-dashed border-border-subtle px-4 py-6 text-center text-sm text-muted-foreground">Drop skills here</p>}
          </DropSection>
        ) : null}

        {builtinFolder ? (
          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Folder size={16} />
              </div>
              <h2 className="m-0 truncate text-base font-semibold text-foreground">{builtinFolder.name}</h2>
              <span className="shrink-0 text-xs text-muted-foreground">{builtinSkills.length}</span>
            </div>
            {builtinSkills.length > 0 ? grid(builtinSkills) : <p className="m-0 rounded-xl border border-dashed border-border-subtle px-4 py-6 text-center text-sm text-muted-foreground">No built-in skills yet. Restart the server.</p>}
          </section>
        ) : null}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeSkill ? (
          <div style={{ width: overlayWidth ?? undefined }}>
            <SkillCard skill={activeSkill} dragging onOpen={() => {}} onDelete={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
