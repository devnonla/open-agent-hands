import type { ReactNode } from "react";
import { Button, Icon, Segmented, Tooltip } from "devnonla-ui";
import { Settings } from "lucide-react";
import { ContentBreadcrumb, ContentHeader } from "src/components/ContentBreadcrumb";
import { FeatureIcon } from "src/components/FeatureIcon";
import { WindowHeaderBackButton } from "src/components/WindowHeaderBackButton";

export type SiteViewMode = "preview" | "editor";

interface SiteEditorHeaderProps {
  title: string;
  viewMode: SiteViewMode;
  onViewModeChange: (mode: SiteViewMode) => void;
  onOpenSettings: () => void;
  actions?: ReactNode;
}

function SiteViewToggle({ value, onChange }: { value: SiteViewMode; onChange: (v: SiteViewMode) => void }) {
  return (
    <Segmented
      size="small"
      value={value}
      onChange={onChange}
      options={[
        {
          value: "preview",
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="eye" size={14} />
              Preview
            </span>
          ),
        },
        {
          value: "editor",
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="code" size={14} />
              Editor
            </span>
          ),
        },
      ]}
    />
  );
}

export function SiteEditorHeader({ title, viewMode, onViewModeChange, onOpenSettings, actions }: SiteEditorHeaderProps) {
  return (
    <ContentHeader
      left={
        <div className="flex min-w-0 items-center gap-2">
          <WindowHeaderBackButton to="/sites" label="Back to sites" />
          <ContentBreadcrumb items={[{ label: "Sites", to: "/sites", icon: <FeatureIcon name="sites" size={16} variant="sticker" /> }, { label: title }]} />
        </div>
      }
      right={
        <div className="flex items-center gap-2">
          {actions}
          <SiteViewToggle value={viewMode} onChange={onViewModeChange} />
          <Tooltip title="Site settings">
            <Button type="icon" size="small" aria-label="Site settings" icon={<Settings size={16} />} onClick={onOpenSettings} />
          </Tooltip>
        </div>
      }
    />
  );
}
