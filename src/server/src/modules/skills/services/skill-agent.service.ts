import type { StructuredToolInterface } from "@langchain/core/tools";
import type { SSEStreamingApi } from "hono/streaming";
import { createAgent } from "langchain";
import { makeRunJsTool } from "../../../common/ai/agent-tools/run-js.tool.js";
import { webFetchTool } from "../../../common/ai/agent-tools/web-fetch.tool.js";
import { writeRunError } from "../../../common/ai/agui-sse.js";
import { type ChatHistoryMessage, buildLangChainMessages } from "../../../common/ai/build-langchain-messages.js";
import { getChatModel } from "../../../common/ai/getChatModel.js";
import { streamAgentSSE } from "../../../common/ai/stream-agent-sse.js";
import { isBuiltinSkillId } from "../../nonla-bot/builtin-ids.js";
import { buildSkillAgentSystemPrompt, makeDeleteSkillFileTool, makeEditSkillFileTool, makeReadSkillFileTool } from "../common/agent-tools/edit-skill-file.tool.js";
import { getSkill } from "../skills.service.js";

export interface SkillStreamRequest {
  providerId: string;
  modelId: string;
  messages: ChatHistoryMessage[];
}

function skillAgentTools(skillId: string, abortSignal?: AbortSignal): StructuredToolInterface[] {
  return [makeReadSkillFileTool(skillId), makeEditSkillFileTool(skillId), makeDeleteSkillFileTool(skillId), webFetchTool, makeRunJsTool({ abortSignal })];
}

export async function streamSkillAgent(skillId: string, body: SkillStreamRequest, stream: SSEStreamingApi, abortSignal?: AbortSignal): Promise<void> {
  try {
    if (isBuiltinSkillId(skillId)) throw new Error("Builtin skills are read-only");
    if (!(await getSkill(skillId))) {
      throw new Error("Skill not found");
    }

    const { providerId, modelId, messages } = body;
    const model = await getChatModel(providerId, modelId);

    const tools: StructuredToolInterface[] = skillAgentTools(skillId, abortSignal);

    const agent = createAgent({
      model,
      tools,
      systemPrompt: await buildSkillAgentSystemPrompt(skillId),
    });

    await streamAgentSSE({
      agent,
      messages: buildLangChainMessages(messages),
      maxSteps: 20,
      stream,
      abortSignal,
      threadId: skillId,
    });
  } catch (err) {
    await writeRunError(stream, err instanceof Error ? err.message : String(err));
  }
}
