import { Icon } from "devnonla-ui";
import { FeatureIcon } from "src/components/FeatureIcon";
import { WindowHeaderBackButton } from "src/components/WindowHeaderBackButton";
import { AgentsContentHeader, ContentBreadcrumb } from "src/modules/agents/components/ContentBreadcrumb";

interface EditSkillHeaderProps {
  title: string;
  onOpenSettings?: () => void;
}

export function EditSkillHeader({ title, onOpenSettings }: EditSkillHeaderProps) {
  return (
    <AgentsContentHeader
      left={
        <div className="flex min-w-0 items-center gap-2">
          <WindowHeaderBackButton to="/skills" label="Back to skills" />
          <ContentBreadcrumb items={[{ label: "Skills", to: "/skills", icon: <FeatureIcon name="skills" size={16} variant="sticker" /> }, { label: title }]} />
        </div>
      }
      right={
        onOpenSettings ? (
          <button type="button" onClick={onOpenSettings} title="Skill settings" aria-label="Skill settings" className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-black/6 hover:text-foreground">
            <Icon name="pen" size={16} />
          </button>
        ) : null
      }
    />
  );
}
