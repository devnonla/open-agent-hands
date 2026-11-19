import { DevNonlaAvatar } from "devnonla-agent-avatar";
import { Icon } from "devnonla-ui";
import { AgentChatbox, type AgentToolHook, type AgentToolResultEvent, type AgentMessage as ChatUiMessage, GetCurrentTimeToolUI, ReadSkillToolUI, RunJsToolUI, WebFetchToolUI } from "devnonla-ui/chat";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiClient, authorizedFetch } from "src/common/api";
import { tapContextUsage } from "src/common/chat/tapContextUsage";
import { SettingKey } from "src/common/enum";
import { stopAgentChat } from "src/common/hooks/useAgent";
import type { AgentConversation, AgentMessage } from "src/common/types";
import { AgentSidePanel } from "src/components/AgentSidePanel";
import { CodeToolAgentUI } from "src/components/CodeToolAgentUI";
import { NonlaBotToolsButton } from "src/components/NonlaBotToolsButton";
import { ContextUsageRing } from "src/components/chat/ContextUsageRing";
import { SelectModel } from "src/components/chat/_components/SelectModel";
import { BackgroundTasksToolUI } from "src/components/chat/_components/tool-uis/BackgroundTasksToolUI";
import { CallAgentStepsToolUI, isCallAgentToolName } from "src/components/chat/_components/tool-uis/CallAgentStepsToolUI";
import { GenericToolUI, withDetachedTask } from "src/components/chat/_components/tool-uis/DetachedTaskToolUI";
import { ManageToolsToolUI } from "src/components/chat/_components/tool-uis/ManageToolsToolUI";
import { markdownFenceComponents } from "src/components/markdown/fenceBlocks";
import { toChatUiMessage } from "src/modules/agents/common/chatMessageMap";
import { ensureLlmProviders } from "src/modules/llm-providers/common/llmProvidersSlice";
import { getSettingValues, saveSettingValues } from "src/modules/settings/common/settingsApi";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { resolveNonlaPage } from "../../server/src/modules/nonla-bot/nonla-page.ts";

const NONLA_BOT_AGENT_ID = "nonla-bot";
const NONLA_FACE = { color: "#f18d00", eyeColor: "black" as const };

const CODE_TOOL_UIS = [
  "nonla_agent_manager",
  "nonla_tool_manager",
  "nonla_skill_manager",
  "nonla_site_manager",
  "nonla_job_manager",
  "nonla_storage_manager",
  "nonla_datatable_manager",
  "nonla_kv_manager",
  "nonla_edit_skill_code",
  "nonla_delete_skill_file",
  "nonla_edit_site_code",
  "nonla_edit_job_code",
  "nonla_writer",
  "nonla_reviewer",
  "nonla_write_tool_draft_code",
  "nonla_review_tool_draft_code",
  "nonla_write_site_draft",
  "nonla_review_site_draft",
  "nonla_write_job_draft",
  "nonla_review_job_draft",
  "nonla_write_agent_instruct",
  "nonla_review_agent_instruct",
  "nonla_tools_manager",
  "nonla_code_site",
  "nonla_code_job",
  "nonla_code_datatable",
  "nonla_code_prompt",
].map((name) => ({ name, component: CodeToolAgentUI }));

const TOOL_UIS = [
  ...CODE_TOOL_UIS,
  { name: isCallAgentToolName, component: CallAgentStepsToolUI },
  { name: "nonla_agent_task", component: CallAgentStepsToolUI },
  { name: "nonla_web_fetch", component: WebFetchToolUI },
  { name: "nonla_run_js", component: withDetachedTask(RunJsToolUI) },
  { name: "nonla_get_current_time", component: GetCurrentTimeToolUI },
  { name: "nonla_read_skill", component: ReadSkillToolUI },
  { name: "nonla_manage_tools", component: ManageToolsToolUI },
  { name: "nonla_background_tasks", component: BackgroundTasksToolUI },
  { name: () => true, component: GenericToolUI },
];

function pathFromGoto(output: unknown): string | null {
  const parsed = typeof output === "string" ? safeJson(output) : output;
  if (!parsed || typeof parsed !== "object") return null;
  const path = (parsed as { ok?: boolean; path?: unknown }).ok === true ? (parsed as { path?: unknown }).path : null;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("..")) return null;
  return path;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function conversationActivity(conv: { createdAt: Date; startedAt: Date | null; finishedAt: Date | null }) {
  let latest = 0;
  for (const stamp of [conv.createdAt, conv.startedAt, conv.finishedAt]) {
    if (!stamp) continue;
    const ms = new Date(stamp).getTime();
    if (ms > latest) latest = ms;
  }
  return latest;
}

export function NonlaBotAssistant() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const page = resolveNonlaPage(pathname);
  const pagePathRef = useRef(page.path);
  pagePathRef.current = page.path;
  const dispatch = useAppDispatch();
  const providerItems = useAppSelector((s) => s.llmProviders.items);
  const providersLoaded = useAppSelector((s) => s.llmProviders.items.length > 0 || s.llmProviders.total === 0);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [providerId, setProviderId] = useState<string | undefined>(undefined);
  const [model, setModel] = useState("");
  const [convId, setConvId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<ChatUiMessage[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [chatKey, setChatKey] = useState("pending");
  const providerInitRef = useRef(false);
  const providerIdRef = useRef(providerId);
  providerIdRef.current = providerId;
  const modelRef = useRef(model);
  modelRef.current = model;
  const convIdRef = useRef<string | null>(null);
  convIdRef.current = convId;
  const convStatusRef = useRef<string | null>(null);

  useEffect(() => {
    void dispatch(ensureLlmProviders());
  }, [dispatch]);

  useEffect(() => {
    if (!providersLoaded || providerItems.length === 0 || providerInitRef.current) return;
    providerInitRef.current = true;
    getSettingValues([SettingKey.NonlaBotAssistantProvider, SettingKey.NonlaBotAssistantModel]).then((s) => {
      const savedProvider = s[SettingKey.NonlaBotAssistantProvider] ?? "";
      const savedModel = s[SettingKey.NonlaBotAssistantModel] ?? "";
      const match = providerItems.find((p) => p.id === savedProvider) ?? providerItems[0];
      setProviderId(match.id);
      setModel(savedModel);
      if (match.id && savedModel) {
        void apiClient.put(`/api/agents/${NONLA_BOT_AGENT_ID}`, { aiProvider: match.id, aiModel: savedModel }).catch(() => {});
      }
    });
  }, [providersLoaded, providerItems]);

  const handleModelChange = (pid: string, nextModel: string) => {
    setProviderId(pid);
    setModel(nextModel);
    void saveSettingValues({
      [SettingKey.NonlaBotAssistantProvider]: pid,
      [SettingKey.NonlaBotAssistantModel]: nextModel,
    });
    if (pid && nextModel) {
      void apiClient.put(`/api/agents/${NONLA_BOT_AGENT_ID}`, { aiProvider: pid, aiModel: nextModel }).catch(() => {});
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const convAtStart = convIdRef.current;
    setHistoryReady(false);
    void (async () => {
      const result = await apiClient.get<{ items: AgentConversation[] }>(`/api/conversations?agentId=${NONLA_BOT_AGENT_ID}&limit=50`);
      if (cancelled) return;
      // A send during this load already owns the chatbox. Do not remount it.
      if (convIdRef.current !== convAtStart) {
        setHistoryReady(true);
        return;
      }
      const latest = [...(result.items ?? [])].sort((a, b) => conversationActivity(b) - conversationActivity(a))[0];
      if (!latest) {
        setConvId(null);
        convStatusRef.current = null;
        setInitialMessages([]);
        setHistoryReady(true);
        return;
      }
      const rows = await apiClient.get<AgentMessage[]>(`/api/conversations/${latest.id}/messages`);
      if (cancelled || convIdRef.current !== convAtStart) {
        if (!cancelled) setHistoryReady(true);
        return;
      }
      setConvId(latest.id);
      convStatusRef.current = latest.status;
      setInitialMessages(rows.map(toChatUiMessage));
      setChatKey(latest.id);
      setHistoryReady(true);
    })().catch(() => {
      if (!cancelled) setHistoryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const startNewChat = () => {
    setConvId(null);
    convStatusRef.current = null;
    setInitialMessages([]);
    setChatKey(`draft-${Date.now()}`);
  };

  const toolHooks: AgentToolHook[] = useMemo(
    () => [
      {
        name: "nonla_goto_page",
        onResult: (event: AgentToolResultEvent) => {
          if (event.error) return;
          const path = pathFromGoto(event.output);
          if (!path || path === window.location.pathname) return;
          navigateRef.current(path);
        },
      },
    ],
    [],
  );

  const send = useCallback(async ({ text, signal }: { text: string; signal: AbortSignal }) => {
    const pid = providerIdRef.current;
    const mid = modelRef.current;
    if (!pid || !mid) throw new Error("Select a model to start chatting");
    let id = convIdRef.current;
    if (!id) {
      const title = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      const created = await apiClient.post<AgentConversation>("/api/conversations", {
        agentId: NONLA_BOT_AGENT_ID,
        title,
        trigger: "manual",
      });
      id = created.id;
      convIdRef.current = id;
      convStatusRef.current = "done";
      setConvId(id);
    }
    const res = await authorizedFetch(`/api/conversations/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ agentId: NONLA_BOT_AGENT_ID, message: text, pagePath: pagePathRef.current }),
      signal,
    });
    return tapContextUsage(res);
  }, []);

  const resume = useCallback(async ({ signal }: { signal: AbortSignal }) => {
    const id = convIdRef.current;
    if (!id || convStatusRef.current !== "running") return null;
    const res = await authorizedFetch(`/api/conversations/${id}/stream`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    });
    return res.ok && res.body ? tapContextUsage(res) : null;
  }, []);

  const onStop = useCallback(async () => {
    const id = convIdRef.current;
    if (!id) return;
    await stopAgentChat(NONLA_BOT_AGENT_ID, id);
  }, []);

  useEffect(() => {
    const inBot = (node: EventTarget | null) => node instanceof Element && Boolean(node.closest("[data-nonla-bot]"));
    const stopIfBot = (event: Event) => {
      if (inBot(event.target)) event.stopImmediatePropagation();
    };
    const stopFocusOut = (event: FocusEvent) => {
      if (inBot(event.relatedTarget)) event.stopImmediatePropagation();
    };
    document.addEventListener("pointerdown", stopIfBot);
    document.addEventListener("focusin", stopIfBot);
    document.addEventListener("focusout", stopFocusOut);
    return () => {
      document.removeEventListener("pointerdown", stopIfBot);
      document.removeEventListener("focusin", stopIfBot);
      document.removeEventListener("focusout", stopFocusOut);
    };
  }, []);

  return (
    <div className="nonla-bot-slot flex h-full shrink-0" data-nonla-bot="">
      {open ? null : (
        <button type="button" aria-expanded={false} aria-label="Open Nonla Bot" onClick={() => setOpen(true)} className="fixed right-5 bottom-5 z-40 flex size-10 cursor-pointer items-center justify-center rounded-full border border-brand-300 bg-brand-100 p-0 shadow-md">
          {generating ? <span className="absolute inset-0 animate-ping rounded-full bg-brand/30" /> : null}
          <DevNonlaAvatar color={NONLA_FACE.color} eyeColor={NONLA_FACE.eyeColor} label="Nonla Bot" size={28} motion="idle" />
        </button>
      )}
      <AgentSidePanel open={open}>
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <DevNonlaAvatar color={NONLA_FACE.color} eyeColor={NONLA_FACE.eyeColor} label="Nonla Bot" size={22} className="shrink-0" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium text-foreground">Nonla Bot</span>
            <span className="block truncate text-[11px] text-muted-foreground">{page.title}</span>
          </span>
          <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)} className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-black/6 hover:text-foreground">
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <AgentChatbox
            key={chatKey}
            initialMessages={initialMessages}
            send={send}
            resume={historyReady ? resume : undefined}
            onStop={onStop}
            toolHooks={toolHooks}
            toolUis={TOOL_UIS}
            components={markdownFenceComponents}
            placeholder={!providerId || !model ? "Select a model…" : "Ask Nonla Bot…"}
            emptyState={historyReady ? <p className="m-auto max-w-52 px-6 py-8 text-center text-[13px] leading-relaxed text-muted-foreground">{page.hint}</p> : <p className="m-auto px-6 py-8 text-center text-[13px] text-muted-foreground">Loading chat…</p>}
            toolbar={
              <>
                <button type="button" onClick={startNewChat} className="flex size-5.5 cursor-pointer items-center justify-center rounded-full text-foreground/90 outline-none transition-all duration-150 hover:bg-border/60" title="New chat" aria-label="New chat">
                  <Plus size={14} strokeWidth={2} />
                </button>
                <ContextUsageRing conversationId={convId} refreshKey={generating ? 0 : 1} />
                <NonlaBotToolsButton />
                <SelectModel providerId={providerId} model={model} onChange={handleModelChange} />
              </>
            }
            onGeneratingChange={setGenerating}
          />
        </div>
      </AgentSidePanel>
    </div>
  );
}
