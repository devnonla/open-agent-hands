import { AgentAvatar, type AgentAvatarMotion, DevNonlaAvatar } from "devnonla-agent-avatar";
import type { StoredAgentAvatar } from "src/components/agentAvatarConfig";

type AgentFaceProps = {
  config: StoredAgentAvatar;
  size?: number;
  motion?: AgentAvatarMotion;
  className?: string;
  label?: string;
};

/** Stored agent face. The hat uses `DevNonlaAvatar`. Every other shape uses `AgentAvatar`. */
export function AgentFace({ config, size, motion, className, label }: AgentFaceProps) {
  if (config.shape === "nonla") {
    return <DevNonlaAvatar color={config.color} eyeColor={config.eyeColor} size={size} motion={motion} className={className} label={label} />;
  }
  return <AgentAvatar config={{ shape: config.shape, color: config.color, eyeColor: config.eyeColor }} size={size} motion={motion} className={className} label={label} />;
}
