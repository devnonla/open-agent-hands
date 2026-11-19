import { AgentChatbox, type AgentMessage as ChatUiMessage } from "devnonla-ui/chat";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { wsClient } from "src/common/api/wsClient";
import type { AgentMessage } from "src/common/types";
import { AgentFace } from "src/components/AgentFace";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";
import { markdownFenceComponents } from "src/components/markdown/fenceBlocks";
import { toChatUiMessage } from "src/modules/agents/common/chatMessageMap";
import { ErrorScreen, HIDDEN_TOOL_NAMES, HistoryPopover, LoadingScreen, PasswordGate, getFingerprint } from "./components";
import type { ConvMeta, PublicAgent } from "./components";

const STARTERS = ["What can you help me with?", "Brainstorm a few ideas with me", "Walk me through how you work"] as const;

const headerBtnClass = "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-black/6 hover:text-foreground";

function mapPublicMessages(rows: AgentMessage[]): ChatUiMessage[] {
  return rows.map(toChatUiMessage).filter((m) => !(m.role === "tool-call" && m.toolName && HIDDEN_TOOL_NAMES.has(m.toolName)));
}

export default function PublicChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<PublicAgent | null>(null);

  const [enteredPassword, setEnteredPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const [conversations, setConversations] = useState<ConvMeta[]>([]);
  const [processingConvIds, setProcessingConvIds] = useState<Set<string>>(new Set());

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(() => `draft-${Date.now()}`);
  const [initialMessages, setInitialMessages] = useState<ChatUiMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const passwordRef = useRef(enteredPassword);
  passwordRef.current = enteredPassword;
  const processingConvIdsRef = useRef(processingConvIds);
  processingConvIdsRef.current = processingConvIds;

  const agentId = agent?.id;

  const HISTORY_PAGE = 30;

  const refreshConversations = useCallback(async (aId: string) => {
    const fp = getFingerprint();
    const res = await fetch(`/api/public/agents/${aId}/conversations?fp=${encodeURIComponent(fp)}&limit=${HISTORY_PAGE}&offset=0`);
    if (!res.ok) return [] as ConvMeta[];
    const data = (await res.json()) as { items: ConvMeta[]; hasMore: boolean };
    setConversations(data.items ?? []);
    return data.items ?? [];
  }, []);

  const loadHistoryPage = useCallback(
    async (offset: number) => {
      if (!agentId) return { items: [] as ConvMeta[], hasMore: false };
      const fp = getFingerprint();
      const res = await fetch(`/api/public/agents/${agentId}/conversations?fp=${encodeURIComponent(fp)}&limit=${HISTORY_PAGE}&offset=${offset}`);
      if (!res.ok) return { items: [] as ConvMeta[], hasMore: false };
      const data = (await res.json()) as { items: ConvMeta[]; hasMore: boolean };
      const items = data.items ?? [];
      setConversations((prev) => (offset === 0 ? items : [...prev, ...items.filter((c) => !prev.some((p) => p.id === c.id))]));
      return { items, hasMore: !!data.hasMore };
    },
    [agentId],
  );

  const loadConversation = useCallback(async (aId: string, convId: string) => {
    setChatLoading(true);
    try {
      const fp = getFingerprint();
      const res = await fetch(`/api/public/agents/${aId}/conversations/${convId}?fp=${encodeURIComponent(fp)}`);
      if (!res.ok) {
        setInitialMessages([]);
        return;
      }
      const data = (await res.json()) as { messages?: AgentMessage[] };
      setInitialMessages(mapPublicMessages(data.messages ?? []));
    } finally {
      setChatLoading(false);
    }
  }, []);

  const switchConversation = useCallback(
    async (aId: string, convId: string) => {
      setConversationId(convId);
      conversationIdRef.current = convId;
      setChatKey(convId);
      navigate(`/chat/${aId}?conv=${convId}`, { replace: true });
      await loadConversation(aId, convId);
    },
    [navigate, loadConversation],
  );

  const newConversation = useCallback(
    (aId: string) => {
      setConversationId(null);
      conversationIdRef.current = null;
      setInitialMessages([]);
      setChatKey(`draft-${Date.now()}`);
      navigate(`/chat/${aId}`, { replace: true });
    },
    [navigate],
  );

  const deleteConversation = useCallback(
    async (aId: string, convId: string) => {
      const fp = getFingerprint();
      await fetch(`/api/public/agents/${aId}/conversations/${convId}?fp=${encodeURIComponent(fp)}`, { method: "DELETE" });
      const convs = await refreshConversations(aId);
      if (convId !== conversationIdRef.current) return;
      const next = convs.find((c) => c.id !== convId);
      if (next) await switchConversation(aId, next.id);
      else newConversation(aId);
    },
    [refreshConversations, switchConversation, newConversation],
  );

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/public/agents/${id}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.message || "Unavailable");
          return;
        }
        setAgent(data);
        if (!data.requiresPassword) {
          setIsAuthenticated(true);
          return;
        }
        const savedToken = localStorage.getItem(`public_auth_${id}`);
        if (!savedToken) return;
        try {
          const tokenRes = await fetch(`/api/public/agents/${id}/verify-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: savedToken }),
          });
          const tokenData = await tokenRes.json();
          if (tokenData.valid) setIsAuthenticated(true);
          else localStorage.removeItem(`public_auth_${id}`);
        } catch {
          localStorage.removeItem(`public_auth_${id}`);
        }
      } catch {
        setError("Unable to connect to server.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!isAuthenticated || !agentId) return;
    void (async () => {
      const urlConvId = searchParams.get("conv");
      const convs = await refreshConversations(agentId);
      if (urlConvId) {
        // URL conv may be beyond the first page — open it directly
        await switchConversation(agentId, urlConvId);
        return;
      }
      if (convs.length > 0) await switchConversation(agentId, convs[0].id);
      else newConversation(agentId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on auth / agent ready
  }, [isAuthenticated, agentId]);

  useEffect(() => {
    return wsClient.on<{ id: string; status: string }>("conversations:updated", (payload) => {
      setProcessingConvIds((prev) => {
        const next = new Set(prev);
        if (payload.status === "running") next.add(payload.id);
        else next.delete(payload.id);
        return next;
      });
      setConversations((prev) => prev.map((c) => (c.id === payload.id ? { ...c, status: payload.status as ConvMeta["status"] } : c)));
    });
  }, []);

  useEffect(() => {
    const runningIds = new Set(conversations.filter((c) => c.status === "running").map((c) => c.id));
    setProcessingConvIds((prev) => {
      const same = prev.size === runningIds.size && [...runningIds].every((x) => prev.has(x));
      return same ? prev : runningIds;
    });
  }, [conversations]);

  const ensureConversation = useCallback(async () => {
    const convId = conversationIdRef.current;
    const current = agentRef.current;
    if (!current) throw new Error("Agent unavailable");
    if (convId) return convId;

    const fp = getFingerprint();
    const res = await fetch(`/api/public/agents/${current.id}/conversations?fp=${encodeURIComponent(fp)}`, { method: "POST" });
    if (!res.ok) throw new Error("Could not create conversation");
    const data = (await res.json()) as { conversationId?: string };
    const createdId = data.conversationId;
    if (!createdId) throw new Error("Could not create conversation");

    conversationIdRef.current = createdId;
    setConversationId(createdId);
    navigate(`/chat/${current.id}?conv=${createdId}`, { replace: true });
    void refreshConversations(current.id);
    return createdId;
  }, [navigate, refreshConversations]);

  const send = useCallback(
    async ({ text, signal }: { text: string; signal: AbortSignal }) => {
      const current = agentRef.current;
      if (!current) throw new Error("Agent unavailable");
      const convId = await ensureConversation();
      const fp = getFingerprint();
      const token = localStorage.getItem(`public_auth_${current.id}`) ?? undefined;
      setProcessingConvIds((prev) => new Set(prev).add(convId));

      return fetch(`/api/public/agents/${current.id}/conversations/${convId}/chat?fp=${encodeURIComponent(fp)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          password: passwordRef.current || undefined,
          token,
        }),
        signal,
      });
    },
    [ensureConversation],
  );

  const resume = useCallback(async ({ signal }: { signal: AbortSignal }) => {
    const convId = conversationIdRef.current;
    const current = agentRef.current;
    if (!convId || !current) return null;
    const conv = conversationsRef.current.find((c) => c.id === convId);
    if (conv?.status !== "running" && !processingConvIdsRef.current.has(convId)) return null;

    const fp = getFingerprint();
    const res = await fetch(`/api/public/agents/${current.id}/conversations/${convId}/stream?fp=${encodeURIComponent(fp)}`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    });
    return res.ok && res.body ? res : null;
  }, []);

  const onGeneratingChange = useCallback(
    (generating: boolean) => {
      const convId = conversationIdRef.current;
      const current = agentRef.current;
      if (generating) {
        if (convId) setProcessingConvIds((prev) => new Set(prev).add(convId));
        return;
      }
      if (convId) {
        setProcessingConvIds((prev) => {
          const next = new Set(prev);
          next.delete(convId);
          return next;
        });
      }
      if (current) void refreshConversations(current.id);
    },
    [refreshConversations],
  );

  const verifyPassword = async (password: string) => {
    if (!password || !agent) return;
    setEnteredPassword(password);
    setVerifying(true);
    setAuthError("");
    try {
      const res = await fetch(`/api/public/agents/${agent.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.valid) {
        if (data.token) localStorage.setItem(`public_auth_${agent.id}`, data.token);
        setIsAuthenticated(true);
      } else {
        setAuthError(data.message || "Incorrect password");
      }
    } catch {
      setAuthError("Connection error.");
    } finally {
      setVerifying(false);
    }
  };

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen error={error} />;
  if (!isAuthenticated && agent?.requiresPassword) {
    return <PasswordGate agentName={agent.name} avatar={agent.avatar} onSubmit={verifyPassword} authError={authError} verifying={verifying} />;
  }
  if (!agent) return <ErrorScreen error="Agent unavailable" />;

  return (
    <section aria-label={agent.name} className="flex h-dvh w-screen flex-col overflow-hidden bg-popover">
      <header className="flex h-11 shrink-0 items-center gap-2 border-0 border-b border-solid border-border px-3">
        <AgentFace config={parseAgentAvatar(agent.avatar)} label={agent.name} size={22} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-none text-foreground">{agent.name}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <HistoryPopover
            conversationId={conversationId}
            processingConvIds={processingConvIds}
            onLoadPage={loadHistoryPage}
            onSelect={(convId) => {
              if (agentId) void switchConversation(agentId, convId);
            }}
            onDelete={async (convId) => {
              if (agentId) await deleteConversation(agentId, convId);
            }}
          />
          <button
            type="button"
            aria-label="New chat"
            title="New chat"
            className={headerBtnClass}
            onClick={() => {
              if (agentId) newConversation(agentId);
            }}
          >
            <Plus size={14} />
          </button>
        </div>
      </header>

      <div className="@container relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-48"
          style={{
            background: "radial-gradient(ellipse 80% 100% at 50% 0%, color-mix(in oklab, var(--muted) 55%, transparent), transparent)",
          }}
        />

        {chatLoading ? (
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            <span className="animate-pulse text-[12px] text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <AgentChatbox
              key={chatKey}
              className="bg-transparent"
              initialMessages={initialMessages}
              send={send}
              resume={resume}
              onGeneratingChange={onGeneratingChange}
              name={agent.name}
              description={agent.description || undefined}
              avatar={<AgentFace config={parseAgentAvatar(agent.avatar)} label={agent.name} size={64} motion="idle" />}
              starters={[...STARTERS]}
              components={markdownFenceComponents}
              placeholder={`Message ${agent.name}...`}
            />
          </div>
        )}
      </div>
    </section>
  );
}
