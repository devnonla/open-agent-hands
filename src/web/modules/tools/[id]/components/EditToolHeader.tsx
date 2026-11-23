import { Button, Tooltip } from "devnonla-ui";
import { Settings } from "lucide-react";
import { ContentBreadcrumb, ContentHeader } from "src/components/ContentBreadcrumb";
import { FeatureIcon } from "src/components/FeatureIcon";

export function EditToolHeader({ label, onOpenSettings }: { label: string; onOpenSettings: () => void }) {
  return (
    <ContentHeader
      left={<ContentBreadcrumb items={[{ label: "Tools", to: "/tools", icon: <FeatureIcon name="tools" size={16} variant="sticker" /> }, { label: label || "Untitled Tool" }]} />}
      right={
        <Tooltip title="Tool settings">
          <Button type="icon" size="small" aria-label="Tool settings" icon={<Settings size={16} />} onClick={onOpenSettings} />
        </Tooltip>
      }
    />
  );
}
