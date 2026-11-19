import { Button, Dropdown } from "devnonla-ui";
import type { MenuProps } from "devnonla-ui";
import { Ellipsis, FolderInput, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "src/common/lib/cn";
import type { Skill } from "src/common/types";
import { FeatureIcon } from "src/components/FeatureIcon";
import RenderIf from "src/components/RenderIf";
import { isBuiltinSkillId } from "../common/builtinSkills";

export function SkillCard({
  skill,
  folders = [],
  onOpen,
  onDelete,
  onMove,
  dragging = false,
  draggable = false,
}: {
  skill: Skill;
  folders?: { id: string; name: string }[];
  onOpen: () => void;
  onDelete: () => void;
  onMove?: (folderId: string | null) => void;
  dragging?: boolean;
  draggable?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const builtin = isBuiltinSkillId(skill.id);

  const menuItems: MenuProps["items"] = useMemo(() => {
    const items: NonNullable<MenuProps["items"]> = [];
    if (onMove && (folders.length > 0 || skill.folderId)) {
      items.push({
        key: "move",
        label: "Move to folder",
        icon: <FolderInput size={14} />,
        children: [
          {
            key: "ungrouped",
            label: "Ungrouped",
            disabled: !skill.folderId,
            onClick: () => onMove(null),
          },
          ...[...folders]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((folder) => ({
              key: folder.id,
              label: folder.name,
              disabled: skill.folderId === folder.id,
              onClick: () => onMove(folder.id),
            })),
        ],
      });
    }
    items.push({ key: "delete", label: "Delete", danger: true, icon: <X size={14} />, onClick: onDelete });
    return items;
  }, [folders, onDelete, onMove, skill.folderId]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${skill.name}`}
      onClick={dragging ? undefined : onOpen}
      onKeyDown={(e) => {
        if (dragging) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group relative flex h-full gap-3 rounded-xl border border-border-subtle bg-card px-4 py-3 text-left",
        "transition-[border-color,background-color] duration-200",
        "hover:border-warn/35 hover:bg-secondary",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        dragging && "shadow-lg ring-1 ring-border",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <FeatureIcon name="skills" size={22} variant="sticker" />
      </div>
      <div className={cn("min-w-0 flex-1", builtin ? "" : "pr-6")}>
        <div className="flex items-center gap-2">
          <h2 className="m-0 truncate text-[15px] font-semibold leading-5 text-foreground">{skill.name}</h2>
        </div>
        <p className="mt-1 mb-0 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{skill.description || "No description"}</p>
      </div>
      <RenderIf condition={!builtin}>
        <div className={cn("absolute right-1.5 top-1.5 z-10", dragging && "hidden")} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <Dropdown menu={{ items: menuItems }} trigger={["click"]} placement="bottomRight" open={menuOpen} onOpenChange={setMenuOpen}>
            <Button type="text" size="small" aria-label={`${skill.name} actions`} className={cn("text-muted-foreground hover:text-foreground", menuOpen && "bg-muted text-foreground")} icon={<Ellipsis size={16} />} />
          </Dropdown>
        </div>
      </RenderIf>
    </div>
  );
}
