import type { MenuProps } from "devnonla-ui";
import { Dropdown, Modal } from "devnonla-ui";
import { Ellipsis, X } from "lucide-react";
import { useState } from "react";
import { cn } from "src/common/lib/cn";
import { ContentBreadcrumb, ContentHeader } from "src/components/ContentBreadcrumb";
import { FeatureIcon } from "src/components/FeatureIcon";

interface EditToolHeaderProps {
  label: string;
  toolId?: string;
  isActive: boolean;
  toggling: boolean;
  deleting: boolean;
  onToggleActive: () => void;
  onDelete: () => void;
}

export function EditToolHeader({ label, toolId, isActive, toggling, deleting, onToggleActive, onDelete }: EditToolHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleDeleteClick = () => {
    setMenuOpen(false);
    Modal.confirm({
      title: `Delete "${label || toolId}"?`,
      content: "This action cannot be undone.",
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: onDelete,
    });
  };

  const menuItems: MenuProps["items"] = [
    {
      key: "delete",
      danger: true,
      disabled: deleting,
      label: (
        <div className="flex items-center gap-2">
          <X size={14} />
          Delete
        </div>
      ),
      onClick: handleDeleteClick,
    },
  ];

  return (
    <ContentHeader
      left={<ContentBreadcrumb items={[{ label: "Tools", to: "/tools", icon: <FeatureIcon name="tools" size={16} variant="sticker" /> }, { label: label || "Untitled Tool" }]} />}
      right={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            role="switch"
            disabled={toggling}
            aria-checked={isActive}
            aria-label={isActive ? "Deactivate tool" : "Activate tool"}
            onClick={onToggleActive}
            className={cn(
              "relative isolate h-6 w-14 shrink-0 rounded-md border border-transparent transition-colors duration-150",
              "cursor-pointer disabled:cursor-not-allowed disabled:opacity-45",
              isActive ? "bg-[color-mix(in_oklab,var(--success)_28%,var(--secondary))] text-success hover:bg-[color-mix(in_oklab,var(--success)_36%,var(--secondary))]" : "bg-secondary text-foreground hover:bg-[color-mix(in_oklab,var(--secondary),white_8%)]",
            )}
          >
            <span className={cn("pointer-events-none absolute inset-y-0 z-0 flex items-center text-[10px] font-semibold leading-none tracking-wide", isActive ? "left-1.5 text-success" : "right-1.5 text-muted-foreground")}>{isActive ? "ON" : "OFF"}</span>
            <span aria-hidden className={cn("pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 z-1 aspect-square rounded-sm bg-card transition-transform duration-150 ease-out", isActive && "translate-x-7.5")} />
          </button>
          <Dropdown trigger={["click"]} placement="bottomRight" open={menuOpen} onOpenChange={setMenuOpen} menu={{ items: menuItems, style: { minWidth: 160 } }}>
            <button type="button" className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-ink-hover hover:text-foreground" aria-label="Tool menu">
              <Ellipsis size={14} />
            </button>
          </Dropdown>
        </div>
      }
    />
  );
}
