/**
 * Run a nested agent. When a parent stream is open, stream each step onto that card.
 * Otherwise wait for the final answer.
 */

import type { BaseMessage } from "@langchain/core/messages";
import { messagesFromAgentStream } from "./agent-result.js";
import { type CallAgentStep, createChildActivityEmitter, currentCallAgentSink, feedChildActivity } from "./call-agent-activity.js";

const NOSTREAM_TAG = "langsmith:nostream";

type ChildAgent = {
  invoke: (input: { messages: BaseMessage[] }, config?: Record<string, unknown>) => Promise<{ messages?: BaseMessage[] }>;
  stream: (input: { messages: BaseMessage[] }, config?: Record<string, unknown>) => Promise<AsyncIterable<unknown>>;
};

export async function runChildAgent(opts: { agent: ChildAgent; messages: BaseMessage[]; recursionLimit: number; abortSignal?: AbortSignal; parentToolCallId?: string; onStep?: (step: CallAgentStep) => void }): Promise<BaseMessage[]> {
  const sink = currentCallAgentSink();
  const parentId = opts.parentToolCallId || "child";
  if (!sink && !opts.onStep) {
    const result = await opts.agent.invoke({ messages: opts.messages }, { recursionLimit: opts.recursionLimit, signal: opts.abortSignal, tags: [NOSTREAM_TAG] });
    return result.messages ?? [];
  }

  const stream = await opts.agent.stream(
    { messages: opts.messages },
    {
      recursionLimit: opts.recursionLimit,
      signal: opts.abortSignal,
      streamMode: ["messages", "updates", "values"] as const,
    },
  );
  const onChunk = createChildActivityEmitter((step) => {
    opts.onStep?.(step);
    return sink?.emit(parentId, step);
  });
  const chunks: { mode: string; data: unknown }[] = [];
  for await (const chunk of stream) {
    const [mode, data] = chunk as [string, unknown];
    await feedChildActivity(onChunk, mode, data);
    if (mode === "updates" || mode === "values") chunks.push({ mode, data });
  }
  return messagesFromAgentStream(chunks, opts.messages.length) as BaseMessage[];
}
