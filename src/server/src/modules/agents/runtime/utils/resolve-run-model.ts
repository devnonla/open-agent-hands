import { eq } from "drizzle-orm";
import { agents, getDb } from "../../../../common/db/client.js";
import { qone } from "../../../../common/db/query.js";
import { NONLA_BOT_AGENT_ID, isCoreManagerAgentId } from "../../../nonla-bot/builtin-ids.js";

export type CallerModel = { providerId?: string; modelId?: string };

export type PickedRunModel = { kind: "fixed"; providerId: string; modelId: string } | { kind: "parent" };

type ModelAgent = { id: string; name: string; aiProvider: string | null; aiModel: string | null };

export function pickRunModel(agent: ModelAgent, caller?: CallerModel): PickedRunModel {
  if (agent.aiProvider && agent.aiModel) {
    return { kind: "fixed", providerId: agent.aiProvider, modelId: agent.aiModel };
  }
  if (!isCoreManagerAgentId(agent.id)) {
    throw new Error(`Agent "${agent.name}" has no AI provider configured`);
  }
  if (caller?.providerId && caller.modelId) {
    return { kind: "fixed", providerId: caller.providerId, modelId: caller.modelId };
  }
  return { kind: "parent" };
}

export async function resolveRunModel(agent: ModelAgent, caller?: CallerModel): Promise<{ providerId: string; modelId: string }> {
  const picked = pickRunModel(agent, caller);
  if (picked.kind === "fixed") return { providerId: picked.providerId, modelId: picked.modelId };

  const parent = await qone(getDb().select({ aiProvider: agents.aiProvider, aiModel: agents.aiModel }).from(agents).where(eq(agents.id, NONLA_BOT_AGENT_ID)));
  if (parent?.aiProvider && parent.aiModel) {
    return { providerId: parent.aiProvider, modelId: parent.aiModel };
  }
  throw new Error(`Agent "${agent.name}" inherits its model, and Nonla Bot has no model set`);
}
