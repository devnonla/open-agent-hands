// ─── Agent Detail Page ────────────────────────────────────────────────────────
// Route: /agents/:id/* — Chat and canvas.

import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { wsClient } from "src/common/api/wsClient";
import type { Agent, AgentListItem, AgentSkillAssignment, AgentTool, AgentToolAssignment } from "src/common/types";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fetchOneAgent, updateAgent, upsertAgentLocal } from "../common/agentsSlice";
import { isBuiltinAgentId } from "../common/builtinAgents";
import { AgentFlowCanvas } from "./canvas/AgentFlowCanvas";
import { ChatPage } from "./chat/ChatPage";
import { type AgentDetailContext, AgentDetailCtx, type ChatHistoryHandlers } from "./common/agentDetailContext";
import { AgentDetailHeader } from "./components/AgentDetailHeader";

// ─── API helpers ───────────────────────────────────────────────────────────────

const API_BASE = "/api";

async function fetchAssignments(agentId: string): Promise<AgentToolAssignment[]> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/tool-assignments`);
  return res.json();
}

async function fetchSkillAssignments(agentId: string): Promise<AgentSkillAssignment[]> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/skill-assignments`);
  return res.json();
}

async function apiRemoveAssignment(agentId: string, assignmentId: string): Promise<void> {
  await fetch(`${API_BASE}/agents/${agentId}/tool-assignments/${assignmentId}`, { method: "DELETE" });
}

async function apiAddAssignment(agentId: string, toolId: string): Promise<AgentToolAssignment> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/tool-assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolId }),
  });
  return res.json();
}

async function apiRemoveSkillAssignment(agentId: string, assignmentId: string): Promise<void> {
  await fetch(`${API_BASE}/agents/${agentId}/skill-assignments/${assignmentId}`, { method: "DELETE" });
}

async function apiAddSkillAssignment(agentId: string, skillId: string): Promise<AgentSkillAssignment> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/skill-assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillId }),
  });
  return res.json();
}

async function apiUpdateCallableAgents(agentId: string, callableAgentIds: string[]): Promise<void> {
  await fetch(`${API_BASE}/agents/${agentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callableAgentIds }),
  });
}

type AgentGate = "loading" | "ready" | "missing" | "deleted" | "error";

function loadErrorText(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string" && err.message.trim()) return err.message;
  return "Failed to load agent";
}

function AgentGateMessage({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="m-0 text-sm text-foreground">{text}</p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const agents = useAppSelector((s) => s.agents.items) as AgentListItem[];
  const allTools = useAppSelector((s) => s.tools.items) as AgentTool[];

  // ── Detail form state (hydrated only from GET /:id — never from list cache) ──
  const [agent, setAgent] = useState<Agent | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [toolAssignments, setToolAssignments] = useState<AgentToolAssignment[]>([]);
  const toolAssignmentsRef = useRef(toolAssignments);
  toolAssignmentsRef.current = toolAssignments;
  const [skillAssignments, setSkillAssignments] = useState<AgentSkillAssignment[]>([]);
  const skillAssignmentsRef = useRef(skillAssignments);
  skillAssignmentsRef.current = skillAssignments;
  const [callableAgentIds, setCallableAgentIds] = useState<string[]>([]);
  const callableAgentIdsRef = useRef(callableAgentIds);
  callableAgentIdsRef.current = callableAgentIds;
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [publicPassword, setPublicPassword] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatHistoryHandlers | null>(null);
  const [gate, setGate] = useState<AgentGate>("loading");
  const [loadError, setLoadError] = useState("");
  const deletedRef = useRef(false);
  const listedIdRef = useRef<string | null>(null);

  // Detail GET is the source of truth for the open agent
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    deletedRef.current = false;
    listedIdRef.current = null;
    setAgent(null);
    setGate("loading");
    setLoadError("");
    setToolAssignments([]);
    setSkillAssignments([]);
    dispatch(fetchOneAgent(id))
      .unwrap()
      .then((ag: Agent) => {
        if (cancelled || deletedRef.current) return;
        setAgent(ag);
        setGate("ready");
        dispatch(upsertAgentLocal(ag));
        setName(ag.name);
        setDescription(ag.description ?? "");
        setAvatar(ag.avatar ?? null);
        setTeamId(ag.teamId ?? null);
        setSystemPrompt(ag.systemPrompt ?? "");
        setAiModel(ag.aiModel ?? "");
        setIsPublic(ag.isPublic ?? false);
        setPublicPassword(ag.publicPassword ?? "");
        setCallableAgentIds(ag.callableAgentIds ?? []);
        setSelectedProviderId(ag.aiProvider ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled || deletedRef.current) return;
        const message = loadErrorText(err);
        if (/not found/i.test(message)) {
          setGate("missing");
          return;
        }
        setLoadError(message);
        setGate("error");
      });
    return () => {
      cancelled = true;
    };
  }, [id, dispatch]);

  const markDeleted = useCallback(() => {
    deletedRef.current = true;
    setGate("deleted");
  }, []);

  useEffect(() => {
    if (!id) return;
    return wsClient.on<{ id: string }>("agents:deleted", (payload) => {
      if (payload.id === id) markDeleted();
    });
  }, [id, markDeleted]);

  // Same-tab delete updates the list even if the socket event is missed.
  useEffect(() => {
    if (!id || deletedRef.current) return;
    const present = agents.some((item) => item.id === id);
    if (present) {
      listedIdRef.current = id;
      return;
    }
    if (listedIdRef.current === id) markDeleted();
  }, [agents, id, markDeleted]);

  // WS / mutations may upsert a full agent into the list store — merge into detail state
  useEffect(() => {
    if (!id) return;
    const fromStore = agents.find((a) => a.id === id) as Partial<Agent> | undefined;
    if (!fromStore || !Object.prototype.hasOwnProperty.call(fromStore, "systemPrompt")) return;
    setAgent((prev) => {
      if (!prev) return prev;
      if (fromStore.systemPrompt === prev.systemPrompt && fromStore.updatedAt === prev.updatedAt) {
        return prev;
      }
      return { ...prev, ...fromStore } as Agent;
    });
  }, [agents, id]);

  const handleProviderChange = useCallback((pid: string | null) => setSelectedProviderId(pid), []);

  // ── Assignment / callable handlers ─────────────────────────────────────────

  const handleRemoveToolAssignment = useCallback(
    (toolId: string) => {
      if (!id || isBuiltinAgentId(id)) return;
      const assignment = toolAssignmentsRef.current.find((a) => a.toolId === toolId);
      if (!assignment) return;
      setToolAssignments((prev) => prev.filter((a) => a.toolId !== toolId));
      apiRemoveAssignment(id, assignment.id).catch(() => {
        fetchAssignments(id).then(setToolAssignments);
      });
    },
    [id],
  );

  const handleAddToolAssignment = useCallback(
    (toolId: string) => {
      if (!id || isBuiltinAgentId(id)) return;
      apiAddAssignment(id, toolId).then((newAssignment) => {
        setToolAssignments((prev) => (prev.some((a) => a.toolId === newAssignment.toolId) ? prev : [...prev, newAssignment]));
      });
    },
    [id],
  );

  const handleRemoveSkillAssignment = useCallback(
    (skillId: string) => {
      if (!id || isBuiltinAgentId(id)) return;
      const assignment = skillAssignmentsRef.current.find((a) => a.skillId === skillId);
      if (!assignment) return;
      setSkillAssignments((prev) => prev.filter((a) => a.skillId !== skillId));
      apiRemoveSkillAssignment(id, assignment.id).catch(() => {
        fetchSkillAssignments(id).then(setSkillAssignments);
      });
    },
    [id],
  );

  const handleAddSkillAssignment = useCallback(
    (skillId: string) => {
      if (!id || isBuiltinAgentId(id)) return;
      apiAddSkillAssignment(id, skillId).then((newAssignment) => {
        setSkillAssignments((prev) => [...prev, newAssignment]);
      });
    },
    [id],
  );

  const handleToggleCallableAgent = useCallback(
    (agentId: string, enable: boolean) => {
      if (!id || isBuiltinAgentId(id)) return;
      const prev = callableAgentIdsRef.current;
      const next = enable ? (prev.includes(agentId) ? prev : [...prev, agentId]) : prev.filter((cid) => cid !== agentId);
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) return;
      setCallableAgentIds(next);
      apiUpdateCallableAgents(id, next).catch(() => {
        if (callableAgentIdsRef.current === next) setCallableAgentIds(prev);
      });
    },
    [id],
  );

  // ── Config handlers (model + name/desc — auto-save) ───────────────────────

  const handleToggleTool = useCallback(
    (toolId: string, enable: boolean) => {
      if (enable) handleAddToolAssignment(toolId);
      else handleRemoveToolAssignment(toolId);
    },
    [handleAddToolAssignment, handleRemoveToolAssignment],
  );

  const handleToggleSkill = useCallback(
    (skillId: string, enable: boolean) => {
      if (enable) handleAddSkillAssignment(skillId);
      else handleRemoveSkillAssignment(skillId);
    },
    [handleAddSkillAssignment, handleRemoveSkillAssignment],
  );

  const handleFlowModelChange = useCallback(
    (providerId: string | null, model: string) => {
      const nextProvider = providerId || null;
      const nextModel = model || "";
      handleProviderChange(nextProvider);
      setAiModel(nextModel);
      if (!id) return;
      if (!nextProvider || !nextModel) {
        void dispatch(updateAgent({ id, aiProvider: null, aiModel: null }));
        return;
      }
      void dispatch(updateAgent({ id, aiProvider: nextProvider, aiModel: nextModel }));
    },
    [id, dispatch, handleProviderChange],
  );

  const handleFlowNameChange = useCallback(
    (newName: string) => {
      if (id && isBuiltinAgentId(id)) return;
      setName(newName);
      if (id && newName.trim()) dispatch(updateAgent({ id, name: newName.trim() }));
    },
    [id, dispatch],
  );

  const handleFlowDescriptionChange = useCallback(
    (newDesc: string) => {
      if (id && isBuiltinAgentId(id)) return;
      setDescription(newDesc);
      if (id) dispatch(updateAgent({ id, description: newDesc.trim() || undefined }));
    },
    [id, dispatch],
  );

  const handleFlowAvatarChange = useCallback(
    async (newAvatar: string) => {
      if (!id || isBuiltinAgentId(id)) return;
      setAvatar(newAvatar);
      await dispatch(updateAgent({ id, avatar: newAvatar })).unwrap();
    },
    [id, dispatch],
  );

  const handleTogglePublish = useCallback(
    (checked: boolean) => {
      if (!id || isBuiltinAgentId(id)) return;
      setIsPublic(checked);
      if (id) dispatch(updateAgent({ id, isPublic: checked }));
    },
    [id, dispatch],
  );

  const handleSavePassword = useCallback(
    async (password: string) => {
      if (!id || isBuiltinAgentId(id)) return;
      setPublicPassword(password);
      await dispatch(updateAgent({ id, publicPassword: password }));
    },
    [id, dispatch],
  );

  // Loading / not found / deleted states
  if (!id) {
    return <Navigate to="/agents" replace />;
  }

  if (gate === "deleted") {
    return <AgentGateMessage text="This agent has been deleted" />;
  }

  if (gate === "missing") {
    return <AgentGateMessage text="Agent not found" />;
  }

  if (gate === "error") {
    return <AgentGateMessage text={loadError} />;
  }

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading agent…</div>
      </div>
    );
  }

  // ── Context ────────────────────────────────────────────────────────────────

  const ctxValue: AgentDetailContext = {
    id,
    agent,
    name,
    setName,
    description,
    setDescription,
    avatar,
    teamId,
    setTeamId,
    selectedProviderId,
    onProviderChange: handleProviderChange,
    aiModel,
    setAiModel,
    systemPrompt,
    setSystemPrompt,
    isPublic,
    setIsPublic,
    publicPassword,
    setPublicPassword,
    toolAssignments,
    setToolAssignments,
    skillAssignments,
    setSkillAssignments,
    callableAgentIds,
    setCallableAgentIds,
    allTools,
    agents,
    onToggleTool: handleToggleTool,
    onToggleSkill: handleToggleSkill,
    onToggleCallableAgent: handleToggleCallableAgent,
    onModelChange: handleFlowModelChange,
    onNameChange: handleFlowNameChange,
    onDescriptionChange: handleFlowDescriptionChange,
    onAvatarChange: handleFlowAvatarChange,
    onTogglePublish: handleTogglePublish,
    onSavePassword: handleSavePassword,
    chatHistory,
    setChatHistory,
    readonly: isBuiltinAgentId(id),
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AgentDetailCtx.Provider value={ctxValue}>
      <div className="flex h-full min-h-0 overflow-hidden">
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AgentDetailHeader id={id} agent={agent} avatar={avatar} />

          <div className="flex min-h-0 flex-1 overflow-hidden bg-transparent">
            <div className="relative h-full min-h-0 min-w-0 flex-1">
              <Routes>
                <Route index element={<Navigate to={isBuiltinAgentId(id) ? "canvas" : "chat"} replace />} />
                <Route path="canvas" element={<AgentFlowCanvas />} />
                <Route path="chat" element={<ChatPage />} />
                <Route path="config" element={<Navigate to={`/agents/${id}/canvas`} replace />} />
                <Route path="editor" element={<Navigate to={`/agents/${id}/canvas`} replace />} />
              </Routes>
            </div>
          </div>
        </div>
      </div>
    </AgentDetailCtx.Provider>
  );
}
