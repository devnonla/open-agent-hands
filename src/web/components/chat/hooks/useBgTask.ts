import { useEffect, useState, useSyncExternalStore } from "react";
import { apiClient } from "src/common/api";
import { wsClient } from "src/common/api/wsClient";
import type { Step } from "../_components/tool-uis/CallAgentStepsToolUI";

export type BgTaskStatus = "running" | "completed" | "failed" | "cancelled" | "expired";

export type BgTaskView = {
  taskId: string;
  toolId?: string;
  toolName: string;
  label?: string;
  conversationId?: string | null;
  status: BgTaskStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  console?: string;
  result?: unknown;
  childConversationId?: string;
  activity?: Step[];
};

const tasks = new Map<string, BgTaskView>();
const listeners = new Map<string, Set<() => void>>();
const requested = new Set<string>();
let offWs: (() => void) | null = null;
let refCount = 0;

function emit(taskId: string) {
  for (const listener of listeners.get(taskId) ?? []) listener();
}

function put(task: BgTaskView) {
  tasks.set(task.taskId, { ...tasks.get(task.taskId), ...task });
  emit(task.taskId);
}

async function load(taskId: string) {
  if (requested.has(taskId)) return;
  requested.add(taskId);
  try {
    const task = await apiClient.get<BgTaskView>(`/api/conversations/bg-tasks/${taskId}`);
    if (!tasks.has(taskId)) put(task);
  } catch {
    if (!tasks.has(taskId)) put({ taskId, toolName: "", status: "expired", startedAt: 0 });
  }
}

function attach() {
  refCount += 1;
  if (refCount === 1) offWs = wsClient.on<BgTaskView>("bg-tasks:updated", put);
}

function detach() {
  refCount -= 1;
  if (refCount > 0) return;
  offWs?.();
  offWs = null;
}

export function seedBgTask(task: BgTaskView) {
  if (!tasks.has(task.taskId)) put(task);
}

export function useBgTask(taskId: string | null | undefined, fallback?: BgTaskView | null): BgTaskView | null {
  useEffect(() => {
    if (!taskId) return;
    attach();
    void load(taskId);
    return detach;
  }, [taskId]);

  const live = useSyncExternalStore(
    (onChange) => {
      if (!taskId) return () => {};
      const set = listeners.get(taskId) ?? new Set<() => void>();
      set.add(onChange);
      listeners.set(taskId, set);
      return () => {
        set.delete(onChange);
      };
    },
    () => (taskId ? tasks.get(taskId) : undefined),
  );

  return live ?? fallback ?? null;
}

export function useNow(active: boolean, stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [active, stepMs]);
  return now;
}

export function useCancelBgTask(task: Pick<BgTaskView, "taskId" | "conversationId"> | null | undefined) {
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    if (!task?.conversationId || busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/conversations/${task.conversationId}/bg-tasks/${task.taskId}/cancel`, {});
    } catch {
      setBusy(false);
    }
  };
  return { busy, cancel };
}
