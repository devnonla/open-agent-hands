import { Button } from "devnonla-ui";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AgentFace } from "src/components/AgentFace";
import { AVATAR_COLORS, AVATAR_SHAPE_CHOICES, type StoredAgentAvatar, agentAvatarJson, parseAgentAvatar, randomAgentAvatarConfig } from "src/components/agentAvatarConfig";
import { cn } from "src/lib/utils";

interface AvatarEditorPanelProps {
  avatar: string | null | undefined;
  name?: string;
  saving?: boolean;
  onChange: (avatar: string) => void | Promise<void>;
}

export function AvatarEditorPanel({ avatar, name, saving, onChange }: AvatarEditorPanelProps) {
  const [config, setConfig] = useState<StoredAgentAvatar>(() => parseAgentAvatar(avatar));

  useEffect(() => {
    setConfig(parseAgentAvatar(avatar));
  }, [avatar]);

  const commit = useCallback(
    (next: StoredAgentAvatar) => {
      setConfig(next);
      void onChange(agentAvatarJson(next));
    },
    [onChange],
  );

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <AgentFace config={config} label={name || "Agent"} size={96} className="shrink-0" motion="idle" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="m-0 text-xs leading-snug text-muted-foreground">Pick a shape and color, or randomize a new look.</p>
          <Button type="default" size="small" disabled={saving} onClick={() => commit(randomAgentAvatarConfig())} icon={<RefreshCw size={14} className={saving ? "animate-spin" : ""} />}>
            Randomize
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Shape</span>
        <div className="grid grid-cols-6 gap-1.5">
          {AVATAR_SHAPE_CHOICES.map((shape) => {
            const active = config.shape === shape;
            return (
              <button key={shape} type="button" title={shape} onClick={() => commit({ ...config, shape })} className={cn("flex cursor-pointer items-center justify-center rounded-lg border p-1", active ? "border-primary/40 bg-primary/10" : "border-border bg-muted")}>
                <AgentFace config={{ shape, color: config.color }} size={28} />
              </button>
            );
          })}
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Color</span>
        <div className="flex flex-wrap gap-1.5">
          {AVATAR_COLORS.map((color) => {
            const active = config.color.toLowerCase() === color.toLowerCase();
            return <button key={color} type="button" title={color} aria-label={color} onClick={() => commit({ ...config, color })} className={cn("size-7 cursor-pointer rounded-full border-2", active ? "border-foreground" : "border-transparent")} style={{ background: color }} />;
          })}
        </div>
      </div>
    </div>
  );
}
