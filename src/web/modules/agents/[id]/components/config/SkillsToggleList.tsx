import { Switch } from "devnonla-ui";
import { useMemo } from "react";
import type { Skill } from "src/common/types";
import { useAppSelector } from "src/store/store";
import { useAgentDetailContext } from "../../common/agentDetailContext";
import { buildSkillItems } from "../../common/configGroups";

export function SkillsToggleList() {
  const { skillAssignments, onToggleSkill, readonly } = useAgentDetailContext();
  const allSkills = useAppSelector((s) => s.skills.items) as Skill[];
  const skills = useMemo(() => {
    const built = buildSkillItems({ allSkills, skillAssignments });
    return readonly ? built.filter((skill) => skill.connected) : built;
  }, [allSkills, skillAssignments, readonly]);

  if (skills.length === 0) {
    return <div className="px-2 py-10 text-center text-[12px] text-muted-foreground">{readonly ? "No skills attached" : "No skills yet — create some in Skills"}</div>;
  }

  return (
    <div className="w-full">
      {skills.map((skill) => (
        <div key={skill.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-ink-hover">
          <div className="min-w-0 truncate text-[13px] font-medium text-foreground">{skill.label}</div>
          <Switch size="small" className="shrink-0" checked={skill.connected} disabled={readonly} onChange={(checked) => onToggleSkill(skill.id, checked)} aria-label={`Toggle ${skill.label}`} />
        </div>
      ))}
    </div>
  );
}
