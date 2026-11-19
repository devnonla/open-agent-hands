import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { Input, Modal } from "devnonla-ui";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentFace } from "src/components/AgentFace";
import { AvatarEditorPanel } from "src/components/AvatarEditorPanel";
import { ModelPicker } from "src/components/ModelPicker";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";
import { isCoreManagerAgentId } from "src/modules/agents/common/builtinAgents";
import { useAgentDetailContext } from "../common/agentDetailContext";
import type { FlowHandle, PortSide } from "./buildAgentCanvas";

type MainAgentNodeType = Node<{ sources: FlowHandle[]; targets: FlowHandle[] }, "agent">;

const PORT: Record<PortSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

const handleClass = "!size-2 !border-0 !bg-transparent !opacity-0";

function portStyle(port: FlowHandle): { top?: string; left?: string } | undefined {
  if (port.along === undefined) return undefined;
  if (port.side === "left" || port.side === "right") return { top: `${port.along}%` };
  return { left: `${port.along}%` };
}

export function MainAgentNode({ data }: NodeProps<MainAgentNodeType>) {
  const { id, name, description, avatar, selectedProviderId, aiModel, readonly, onNameChange, onDescriptionChange, onAvatarChange, onModelChange } = useAgentDetailContext();
  const inheritsModel = Boolean(id && isCoreManagerAgentId(id));
  const [localName, setLocalName] = useState(name);
  const [localDesc, setLocalDesc] = useState(description);
  const [localAvatar, setLocalAvatar] = useState(avatar);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const nameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAvatar = useRef<string | null>(null);
  const onAvatarChangeRef = useRef(onAvatarChange);
  onAvatarChangeRef.current = onAvatarChange;

  useEffect(() => setLocalName(name), [name]);
  useEffect(() => setLocalDesc(description), [description]);
  useEffect(() => setLocalAvatar(avatar), [avatar]);

  const face = useMemo(() => parseAgentAvatar(localAvatar), [localAvatar]);
  const tintStyle = useMemo(
    () =>
      ({
        "--agent-tint": face.color,
        borderColor: "color-mix(in srgb, var(--agent-tint) 65%, var(--card))",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--agent-tint) 14%, var(--card)), var(--card) 45%)",
        boxShadow: "0 4px 12px -4px color-mix(in srgb, var(--agent-tint) 22%, transparent)",
      }) as CSSProperties,
    [face.color],
  );
  const flushAvatar = useCallback(async () => {
    if (avatarDebounce.current) {
      clearTimeout(avatarDebounce.current);
      avatarDebounce.current = null;
    }
    const next = pendingAvatar.current;
    if (next == null) return;
    pendingAvatar.current = null;
    setAvatarSaving(true);
    try {
      await onAvatarChange(next);
    } finally {
      setAvatarSaving(false);
    }
  }, [onAvatarChange]);

  const handleAvatarChange = useCallback(
    (next: string) => {
      setLocalAvatar(next);
      pendingAvatar.current = next;
      if (avatarDebounce.current) clearTimeout(avatarDebounce.current);
      avatarDebounce.current = setTimeout(() => {
        void flushAvatar();
      }, 400);
    },
    [flushAvatar],
  );

  useEffect(
    () => () => {
      if (nameDebounce.current) clearTimeout(nameDebounce.current);
      if (descDebounce.current) clearTimeout(descDebounce.current);
      if (avatarDebounce.current) clearTimeout(avatarDebounce.current);
      const next = pendingAvatar.current;
      if (next != null) void onAvatarChangeRef.current(next);
    },
    [],
  );

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setLocalName(next);
      if (nameDebounce.current) clearTimeout(nameDebounce.current);
      nameDebounce.current = setTimeout(() => onNameChange(next), 600);
    },
    [onNameChange],
  );

  const handleDescChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      setLocalDesc(next);
      if (descDebounce.current) clearTimeout(descDebounce.current);
      descDebounce.current = setTimeout(() => onDescriptionChange(next), 600);
    },
    [onDescriptionChange],
  );

  const sources = data.sources ?? [];
  const targets = data.targets ?? [];

  return (
    <div className="nodrag nopan flex min-h-115 w-90 flex-col gap-4 rounded-xl border-2 px-4 py-4" style={tintStyle}>
      {targets.map((port) => (
        <Handle key={port.id} id={port.id} type="target" position={PORT[port.side]} className={handleClass} style={portStyle(port)} />
      ))}
      {sources.map((port) => (
        <Handle key={port.id} id={port.id} type="source" position={PORT[port.side]} className={handleClass} style={portStyle(port)} />
      ))}
      <button type="button" className="nodrag nopan mx-auto cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default" aria-label="Edit avatar" disabled={readonly} onClick={() => setAvatarOpen(true)}>
        <AgentFace config={face} label={localName || name} size={108} motion="idle" />
      </button>
      <Modal
        open={avatarOpen}
        title="Avatar"
        footer={null}
        onCancel={() => {
          void flushAvatar();
          setAvatarOpen(false);
        }}
        destroyOnHidden
        width={420}
      >
        <AvatarEditorPanel avatar={localAvatar} name={localName || name} saving={avatarSaving} onChange={handleAvatarChange} />
      </Modal>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</span>
        <Input value={localName} onChange={handleNameChange} placeholder="Agent name" spellCheck={false} disabled={readonly} aria-label="Name" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Description</span>
        <Input.TextArea value={localDesc} onChange={handleDescChange} placeholder="What does this agent do?" spellCheck={false} autoSize={{ minRows: 3, maxRows: 5 }} disabled={readonly} aria-label="Description" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Model</span>
        <ModelPicker selectedProviderId={selectedProviderId} selectedModel={aiModel} onChange={onModelChange} allowInherit={inheritsModel} onInherit={() => onModelChange(null, "")} placeholder={inheritsModel ? "Inherit" : "Select model…"} />
      </div>
    </div>
  );
}
