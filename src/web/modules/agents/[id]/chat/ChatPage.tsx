import { AgentChatbox, type AgentMessage as ChatUiMessage, GetCurrentTimeToolUI, ReadSkillToolUI, RunJsToolUI, WebFetchToolUI } from "devnonla-ui/chat";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiClient, authorizedFetch } from "src/common/api";
import { tapContextUsage } from "src/common/chat/tapContextUsage";
import { stopAgentChat } from "src/common/hooks/useAgent";
import type { AgentMessage } from "src/common/types";
import { AgentFace } from "src/components/AgentFace";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";
import { BackgroundTasksPanel } from "src/components/chat/BackgroundTasksPanel";
import { ContextUsageRing } from "src/components/chat/ContextUsageRing";
import { SelectModel } from "src/components/chat/_components/SelectModel";
import { BackgroundTasksToolUI } from "src/components/chat/_components/tool-uis/BackgroundTasksToolUI";
import { CallAgentStepsToolUI, isCallAgentToolName } from "src/components/chat/_components/tool-uis/CallAgentStepsToolUI";
import { GenericToolUI, withDetachedTask } from "src/components/chat/_components/tool-uis/DetachedTaskToolUI";
import { ManageToolsToolUI } from "src/components/chat/_components/tool-uis/ManageToolsToolUI";
import { RunCurrentScriptToolUI } from "src/components/chat/_components/tool-uis/RunCurrentScriptToolUI";
import { useConversationBgTasks } from "src/components/chat/hooks/useConversationBgTasks";
import { markdownFenceComponents } from "src/components/markdown/fenceBlocks";
import { updateAgent } from "src/modules/agents/common/agentsSlice";
import { isBuiltinAgentId, isCoreManagerAgentId } from "src/modules/agents/common/builtinAgents";
import { toChatUiMessage } from "src/modules/agents/common/chatMessageMap";
import { createConversation, deleteConversation, fetchConversations, markConversationDone, setActiveConversationId, updateConversation } from "src/modules/agents/common/chatSlice";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { useAgentDetailContext } from "../common/agentDetailContext";
import { ChatEmptyState } from "./components/ChatEmptyState";
import { ChatToolsButton } from "./components/ChatToolsButton";

const APP_TOOL_UIS = [
  { name: isCallAgentToolName, component: CallAgentStepsToolUI },
  { name: "nonla_agent_task" as const, component: CallAgentStepsToolUI },
  { name: "nonla_run_current_script" as const, component: RunCurrentScriptToolUI },
  { name: "nonla_web_fetch" as const, component: WebFetchToolUI },
  { name: "nonla_run_js" as const, component: withDetachedTask(RunJsToolUI) },
  { name: "nonla_get_current_time" as const, component: GetCurrentTimeToolUI },
  { name: "nonla_read_skill" as const, component: ReadSkillToolUI },
  { name: "nonla_manage_tools" as const, component: ManageToolsToolUI },
  { name: "nonla_background_tasks" as const, component: BackgroundTasksToolUI },
  { name: () => true, component: GenericToolUI },
];

function conversationActivity(conv: { createdAt: Date; startedAt: Date | null; finishedAt: Date | null }) {
  let latest = 0;
  for (const stamp of [conv.createdAt, conv.startedAt, conv.finishedAt]) {
    if (!stamp) continue;
    const ms = new Date(stamp).getTime();
    if (ms > latest) latest = ms;
  }
  return latest;
}

export function ChatPage() {
  const { agent, onProviderChange, setAiModel, selectedProviderId, aiModel, systemPrompt, setChatHistory } = useAgentDetailContext();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeConversationId = useAppSelector((s) => s.chat.activeConversationId);
  const conversations = useAppSelector((s) => s.chat.conversations);
  const { tasks: bgTasks, cancellingIds, cancel: cancelBgTask } = useConversationBgTasks(activeConversationId);

  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const aiModelRef = useRef(aiModel);
  aiModelRef.current = aiModel;

  // Remount AgentChatbox when switching conversations; keep draft key while first send creates a conv
  const [chatKey, setChatKey] = useState(() => activeConversationId ?? `draft-${Date.now()}`);
  const [initialMessages, setInitialMessages] = useState<ChatUiMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextRefresh, setContextRefresh] = useState(0);

  const prevAgentIdRef = useRef<string | null>(null);

  const loadMessages = useCallback(async (convId: string) => {
    const rows = await apiClient.get<AgentMessage[]>(`/api/conversations/${convId}/messages`);
    return rows.map(toChatUiMessage);
  }, []);

  // Load conversations when agent changes
  useEffect(() => {
    if (!agent) return;
    if (prevAgentIdRef.current === agent.id) return;
    prevAgentIdRef.current = agent.id;

    setInitialMessages([]);
    setChatKey(`draft-${Date.now()}`);
    dispatch(setActiveConversationId(null));
    const urlConvId = searchParams.get("conv");
    setLoading(true);
    let cancelled = false;
    dispatch(fetchConversations(agent.id))
      .unwrap()
      .then(async (convs) => {
        if (cancelled) return;
        const forAgent = convs.filter((c) => c.agentId === agent.id);
        const fromUrl = urlConvId ? forAgent.find((c) => c.id === urlConvId) : null;
        const target =
          fromUrl ??
          forAgent.reduce<(typeof forAgent)[number] | null>((best, conv) => {
            if (!best || conversationActivity(conv) > conversationActivity(best)) return conv;
            return best;
          }, null);
        if (!target) return;
        dispatch(setActiveConversationId(target.id));
        const messages = await loadMessages(target.id);
        if (cancelled) return;
        setInitialMessages(messages);
        setChatKey(target.id);
        if (fromUrl) return;
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev);
            p.set("conv", target.id);
            return p;
          },
          { replace: true },
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on agent switch
  }, [agent?.id]);

  const handleSelectConversation = useCallback(
    async (convId: string) => {
      if (convId === activeConversationIdRef.current && chatKey === convId) return;
      setLoading(true);
      try {
        setInitialMessages(await loadMessages(convId));
        setChatKey(convId);
        dispatch(setActiveConversationId(convId));
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev);
            p.set("conv", convId);
            return p;
          },
          { replace: true },
        );
      } finally {
        setLoading(false);
      }
    },
    [dispatch, setSearchParams, loadMessages, chatKey],
  );

  const chatPaneRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef(false);

  const handleNewChat = useCallback(() => {
    dispatch(setActiveConversationId(null));
    activeConversationIdRef.current = null;
    setInitialMessages([]);
    pendingFocusRef.current = true;
    setChatKey(`draft-${Date.now()}`);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("conv");
        return p;
      },
      { replace: true },
    );
  }, [dispatch, setSearchParams]);

  const handleDeleteHistory = useCallback(
    async (convId: string) => {
      const wasActive = convId === activeConversationIdRef.current;
      const rest = conversationsRef.current.filter((item) => item.agentId === agentRef.current.id && item.id !== convId);
      await dispatch(deleteConversation(convId)).unwrap();
      if (!wasActive) return;
      const next = rest[0];
      if (next) {
        await handleSelectConversation(next.id);
        return;
      }
      handleNewChat();
    },
    [dispatch, handleSelectConversation, handleNewChat],
  );

  const selectHistoryRef = useRef(handleSelectConversation);
  selectHistoryRef.current = handleSelectConversation;
  const deleteHistoryRef = useRef(handleDeleteHistory);
  deleteHistoryRef.current = handleDeleteHistory;

  useLayoutEffect(() => {
    setChatHistory({
      onSelect: (convId) => {
        void selectHistoryRef.current(convId);
      },
      onDelete: (convId) => deleteHistoryRef.current(convId),
    });
    return () => setChatHistory(null);
  }, [setChatHistory]);

  useLayoutEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    chatPaneRef.current?.querySelector<HTMLTextAreaElement>("[data-chat-input]")?.focus({ preventScroll: true });
  }, [chatKey]);

  const ensureConversation = useCallback(
    async (text: string) => {
      let convId = activeConversationIdRef.current;
      const currentAgent = agentRef.current;
      if (!convId) {
        const title = text.length > 80 ? `${text.slice(0, 80)}…` : text;
        const created = await dispatch(createConversation({ agentId: currentAgent.id, title })).unwrap();
        convId = created.id;
        activeConversationIdRef.current = convId;
        dispatch(setActiveConversationId(convId));
        void dispatch(fetchConversations(currentAgent.id));
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev);
            p.set("conv", created.id);
            return p;
          },
          { replace: true },
        );
      } else {
        const active = conversationsRef.current.find((c) => c.id === convId);
        if (active?.title === "New Chat") {
          const title = text.length > 80 ? `${text.slice(0, 80)}…` : text;
          void dispatch(updateConversation({ id: convId, title }));
        }
      }
      return convId;
    },
    [dispatch, setSearchParams],
  );

  // AgentChatbox owns streaming UI — app only returns SSE Response
  const send = useCallback(
    async ({ text, signal }: { text: string; signal: AbortSignal }) => {
      if (!(aiModelRef.current || agentRef.current.aiModel) && !isCoreManagerAgentId(agentRef.current.id)) {
        throw new Error("Select a model to start chatting");
      }
      const convId = await ensureConversation(text);
      const res = await authorizedFetch(`/api/conversations/${convId}/chat`, {
        method: "POST",
        body: JSON.stringify({ agentId: agentRef.current.id, message: text }),
        signal,
      });
      return tapContextUsage(res);
    },
    [ensureConversation],
  );

  const resume = useCallback(async ({ signal }: { signal: AbortSignal }) => {
    const convId = activeConversationIdRef.current;
    if (!convId) return null;
    const conv = conversationsRef.current.find((c) => c.id === convId);
    if (conv?.status !== "running") return null;

    const res = await authorizedFetch(`/api/conversations/${convId}/stream`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    });
    return res.ok && res.body ? tapContextUsage(res) : null;
  }, []);

  const onStop = useCallback(async () => {
    const convId = activeConversationIdRef.current;
    if (!convId) return;
    await stopAgentChat(agentRef.current.id, convId);
    void dispatch(fetchConversations(agentRef.current.id));
  }, [dispatch]);

  const onGeneratingChange = useCallback(
    (generating: boolean) => {
      if (generating) return;
      setContextRefresh((value) => value + 1);
      const convId = activeConversationIdRef.current;
      if (convId) dispatch(markConversationDone(convId));
      void dispatch(fetchConversations(agentRef.current.id));
    },
    [dispatch],
  );

  const coreManager = isCoreManagerAgentId(agent.id);
  const ownModel = aiModel || agent.aiModel || "";
  const noModel = !ownModel && !coreManager;
  const modelLocked = isBuiltinAgentId(agent.id) && !coreManager;
  const hasInstruct = Boolean(systemPrompt.trim());

  return (
    <div className="@container relative flex h-full min-w-0 flex-1 flex-col">
      {loading ? (
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <span className="animate-pulse text-[12px] text-muted-foreground">Loading...</span>
        </div>
      ) : (
        <div ref={chatPaneRef} className={["relative flex min-h-0 flex-1 flex-col"].join(" ")}>
          <AgentChatbox
            key={chatKey}
            initialMessages={initialMessages}
            send={send}
            resume={resume}
            onStop={onStop}
            onGeneratingChange={onGeneratingChange}
            name={agent.name}
            description={agent.description ?? undefined}
            avatar={<AgentFace config={parseAgentAvatar(agent.avatar)} label={agent.name} size={112} motion="idle" />}
            starters={[]}
            emptyState={!hasInstruct ? <ChatEmptyState agent={agent} missingInstruct onAddInstruct={() => navigate(`/agents/${agent.id}/canvas`, { state: { openInstruct: true } })} /> : undefined}
            placeholder={noModel ? "Select a model to start chatting" : `Message ${agent.name}...`}
            toolUis={APP_TOOL_UIS}
            components={markdownFenceComponents}
            toolbar={
              <>
                <button type="button" onClick={handleNewChat} className="flex size-5.5 cursor-pointer items-center justify-center rounded-full text-foreground/90 outline-none transition-all duration-150 hover:bg-border/60" title="New chat" aria-label="New chat">
                  <Plus size={14} strokeWidth={2} />
                </button>
                <ContextUsageRing conversationId={activeConversationId} refreshKey={contextRefresh} />
                <ChatToolsButton />
                <SelectModel
                  providerId={selectedProviderId ?? agent.aiProvider ?? undefined}
                  model={ownModel || undefined}
                  disabled={modelLocked}
                  allowInherit={coreManager}
                  emptyLabel={coreManager ? "Inherit" : undefined}
                  onInherit={() => {
                    onProviderChange(null);
                    setAiModel("");
                    void dispatch(updateAgent({ id: agent.id, aiProvider: null, aiModel: null }));
                  }}
                  onChange={(pid, m) => {
                    if (modelLocked) return;
                    onProviderChange(pid);
                    setAiModel(m);
                    void dispatch(updateAgent({ id: agent.id, aiProvider: pid, aiModel: m }));
                  }}
                />
              </>
            }
            accessory={
              <BackgroundTasksPanel tasks={bgTasks} cancellingIds={cancellingIds} onCancel={cancelBgTask}>
                <div className="h-0" aria-hidden />
              </BackgroundTasksPanel>
            }
          />
        </div>
      )}
    </div>
  );
}
