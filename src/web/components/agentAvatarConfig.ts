import { AGENT_AVATAR_PARTS, type AgentAvatarConfig, type AgentAvatarEyeColor } from "devnonla-agent-avatar";

const SHAPES = AGENT_AVATAR_PARTS.shape;
const COLORS = AGENT_AVATAR_PARTS.color;
const SHAPE_SET = new Set<string>([...SHAPES, "nonla"]);

/** Geometric faces from the package, plus the Nonla hat (`DevNonlaAvatar`). */
export const AVATAR_SHAPE_CHOICES = [...SHAPES, "nonla"] as const;
export const AVATAR_COLORS = COLORS;

export type StoredAgentAvatar = {
  shape: AgentAvatarConfig["shape"] | "nonla";
  color: string;
  eyeColor?: AgentAvatarEyeColor;
};

const DEFAULT_AVATAR: StoredAgentAvatar = {
  shape: "circle",
  color: COLORS[0]!,
};

export function randomAgentAvatarConfig(): StoredAgentAvatar {
  return {
    shape: SHAPES[Math.floor(Math.random() * SHAPES.length)]!,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
  };
}

export function agentAvatarJson(config: StoredAgentAvatar = randomAgentAvatarConfig()): string {
  return JSON.stringify({
    shape: config.shape,
    color: config.color,
    ...(config.eyeColor ? { eyeColor: config.eyeColor } : {}),
  });
}

/** Stored string is `{ shape, color, eyeColor? }`. Missing or old JSON falls back to a circle. */
export function parseAgentAvatar(avatar: string | null | undefined): StoredAgentAvatar {
  if (avatar?.startsWith("{") && avatar.endsWith("}")) {
    try {
      const raw = JSON.parse(avatar) as { shape?: unknown; color?: unknown; eyeColor?: unknown };
      if (typeof raw.shape === "string" && SHAPE_SET.has(raw.shape)) {
        const color = typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : DEFAULT_AVATAR.color;
        const eyeColor = raw.eyeColor === "white" || raw.eyeColor === "black" ? raw.eyeColor : undefined;
        return { shape: raw.shape as StoredAgentAvatar["shape"], color, ...(eyeColor ? { eyeColor } : {}) };
      }
    } catch {
      /* old or broken json */
    }
  }
  return DEFAULT_AVATAR;
}
