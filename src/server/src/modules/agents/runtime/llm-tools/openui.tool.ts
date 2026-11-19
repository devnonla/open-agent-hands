import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { repairOpenUiSource } from "./openui-repair.js";

const GUIDE = `OpenUI Lang — interactive UI in chat (charts, tables, forms, cards).

Write a line-oriented program. First line must be root = Stack([...]).

Good weather card:
root = Stack([card])
card = Card([CardHeader("Hanoi", "Today"), TextContent("28°C · Partly cloudy", "large-heavy")])

Common components (positional args):
- Stack(children, direction?, gap?, align?, justify?, wrap?)
- Card(children, variant?, direction?, gap?, align?, justify?, wrap?)
- CardHeader(title, subtitle?)
- TextContent(text, size?)
- BarChart(labels, series, variant?, xLabel?, yLabel?, height?)
- LineChart(labels, series, ...)
- PieChart(labels, values, ...)
- Form(name, buttons, fields?)
- FormControl(label, input, hint?)
- Input(name, placeholder?, type?, rules?, value?)
- Button(label, action?, variant?, type?, size?)
- Buttons(buttons, direction?)
- Tabs(items) / TabItem(value, trigger, content)
- AccordionItem(value, trigger, content)

When NOT to use OpenUI:
- Read-only tables: use a normal markdown table in the reply instead of OpenUI Table/Col.
- Plain prose or lists: stay in markdown.

Array rules (most common mistakes):
- Stack/Card/Tabs/Buttons first arg MUST be an array: Stack([a, b]), Card([header, body])
- TabItem/AccordionItem content MUST be an array, even for one child:
  WRONG: TabItem("w", "Weather", Card([TextContent("Hi")]))
  RIGHT: TabItem("w", "Weather", [Card([TextContent("Hi")])])
- One child still needs brackets: [card], [title], [Card([...])]
- Prefer Stack + Card for simple widgets. Use Tabs only when the user asked for tabs.

Rules:
- Raw OpenUI Lang only inside source. No markdown fences, no prose.
- Prefer real numbers from tool results. Do not invent business data.
- After this tool returns, paste the markdown field verbatim into your assistant reply.`;

function stripFences(source: string): string {
  const trimmed = source.trim();
  const match = trimmed.match(/^```(?:openui)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
}

export const openuiTool = tool(
  async (input: { action?: string; source?: string }) => {
    const action = (input.action ?? "render").trim().toLowerCase();
    if (action === "guide") {
      return JSON.stringify({ ok: true, action: "guide", guide: GUIDE });
    }
    if (action !== "render") {
      return JSON.stringify({ ok: false, error: 'action must be "guide" or "render".' });
    }
    const source = repairOpenUiSource(stripFences(input.source ?? ""));
    if (!source) {
      return JSON.stringify({
        ok: false,
        error: "source is required for action=render.",
        hint: 'Call action="guide" first if you need the OpenUI Lang syntax.',
      });
    }
    if (!/\broot\s*=/.test(source)) {
      return JSON.stringify({
        ok: false,
        error: "OpenUI Lang must define root = Stack(...).",
        hint: GUIDE,
      });
    }
    const markdown = `\`\`\`openui\n${source}\n\`\`\``;
    return JSON.stringify({
      ok: true,
      action: "render",
      markdown,
      hint: "Paste the markdown field verbatim into your next assistant message so the UI renders.",
    });
  },
  {
    name: "nonla_openui",
    description: `Render interactive OpenUI in chat (charts, tables, forms, dashboards). Use only when the user needs UI, not plain text.
Actions:
- guide: return OpenUI Lang syntax rules and component signatures.
- render: pass source (raw OpenUI Lang, must include root = Stack([...])). Returns a markdown fence to paste into your reply.
Array gotchas: TabItem/AccordionItem content and Stack/Card children must be arrays — wrap a single Card as [Card(...)]. Prefer Stack+Card for simple widgets.
Do not wrap source in markdown fences. After render, include the returned markdown field verbatim in your assistant message.`,
    schema: z.object({
      action: z.enum(["guide", "render"]).describe("guide = syntax help. render = wrap OpenUI Lang for the chat UI."),
      source: z.string().optional().describe("Raw OpenUI Lang program for action=render. Must define root = Stack([...])."),
    }),
  },
);

export const TOOL_DEF = {
  toolName: "nonla_openui",
  toolLabel: "OpenUI",
  description: "Render interactive OpenUI (charts, tables, forms) in chat via an openui markdown fence. Call guide for syntax, render with OpenUI Lang source. Children/content args must be arrays.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["guide", "render"], description: "guide or render" },
      source: { type: "string", description: "Raw OpenUI Lang for action=render" },
    },
    required: ["action"],
  },
};
