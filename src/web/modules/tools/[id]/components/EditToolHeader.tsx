import type { MenuProps } from "devnonla-ui";
import { Dropdown, Modal } from "devnonla-ui";
import { Ellipsis, X } from "lucide-react";
import { useState } from "react";
import { ContentBreadcrumb, ContentHeader } from "src/components/ContentBreadcrumb";
import { FeatureIcon } from "src/components/FeatureIcon";

interface EditToolHeaderProps {
  label: string;
  toolId?: string;
  deleting: boolean;
  onDelete: () => void;
}

export function EditToolHeader({ label, toolId, deleting, onDelete }: EditToolHeaderProps) {
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
