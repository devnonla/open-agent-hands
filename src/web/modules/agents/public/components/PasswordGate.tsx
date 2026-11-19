import { AgentFace } from "src/components/AgentFace";
import { PublicUnlockScreen } from "src/components/PublicUnlockScreen";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";

interface PasswordGateProps {
  agentName: string;
  avatar?: string | null;
  onSubmit: (password: string) => void;
  authError: string;
  verifying: boolean;
}

export function PasswordGate({ agentName, avatar, onSubmit, authError, verifying }: PasswordGateProps) {
  return <PublicUnlockScreen icon={<AgentFace config={parseAgentAvatar(avatar)} label={agentName} size={48} className="shrink-0" motion="idle" />} title={agentName} description="Enter password to continue" error={authError} verifying={verifying} onSubmit={onSubmit} />;
}
