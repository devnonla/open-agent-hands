import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { type EditHunk, OMITTED_EDIT_TOOL_ERROR, applyEdits, editPayloadIsOmitted, normalizeToLf } from "../../../../common/ai/apply-exact-replace.js";
import { HttpException } from "../../../../common/exceptions/http.exception.js";
import { runLiveJobCode } from "../../../jobs/jobs-runner.js";
import { createJob, deleteJob, getJob, getJobCode, getJobRun, listJobs, saveJobCode, toPublicJobRun, updateJob } from "../../../jobs/jobs.service.js";

type Fields = Record<string, unknown>;

function ok(result: unknown): string {
  return JSON.stringify({ ok: true, result });
}

function fail(error: string): string {
  return JSON.stringify({ ok: false, error });
}

function errorMessage(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requireId(fields: { id?: string }): string {
  const id = text(fields.id);
  if (!id) throw new Error("'id' is required");
  return id;
}

const MANAGE_SCHEMA = z.object({
  action: z.string().describe("list, get, create, update, delete"),
  id: z.string().optional().describe("Job id for get, update, delete"),
  name: z.string().optional().describe("Job name for create or update"),
  description: z.string().optional().describe("Job description for create or update"),
  body: z.record(z.string(), z.any()).optional().describe("cron, timeoutMs. Script source is ignored."),
});

export function makeManageJobsTool(): StructuredToolInterface {
  return tool(
    async (input: { action?: string; id?: string; name?: string; description?: string; body?: Fields }) => {
      try {
        const action = text(input.action);
        if (!action) return fail("'action' is required");
        if (action === "list") {
          const result = await listJobs({ limit: "100" });
          return ok(result.items.map((job) => ({ id: job.id, name: job.name, description: job.description, cron: job.cron, enabled: job.enabled })));
        }
        if (action === "get") {
          const job = await getJob(requireId(input));
          if (!job) return fail("Job not found");
          return ok({
            id: job.id,
            name: job.name,
            description: job.description,
            cron: job.cron,
            enabled: job.enabled,
            timeoutMs: job.timeoutMs,
          });
        }
        if (action === "create") {
          const name = text(input.name);
          if (!name) return fail("'name' is required");
          const created = await createJob({
            name,
            description: text(input.description) || null,
            cron: typeof input.body?.cron === "string" ? input.body.cron : "",
            timeoutMs: typeof input.body?.timeoutMs === "number" ? input.body.timeoutMs : undefined,
          });
          return ok({ id: created.id, name: created.name, path: `/jobs/${created.id}` });
        }
        if (action === "update") {
          const updated = await updateJob(requireId(input), {
            ...(typeof input.name === "string" ? { name: input.name } : {}),
            ...(typeof input.description === "string" ? { description: input.description } : {}),
            ...(typeof input.body?.cron === "string" ? { cron: input.body.cron } : {}),
            ...(typeof input.body?.timeoutMs === "number" ? { timeoutMs: input.body.timeoutMs } : {}),
          });
          return ok({ id: updated.id, name: updated.name });
        }
        if (action === "delete") {
          const id = requireId(input);
          await deleteJob(id);
          return ok({ deleted: id });
        }
        return fail(`Unknown action "${action}". Use list, get, create, update, delete.`);
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_manage_jobs",
      description: `Add, edit, and delete jobs. Does not edit the script. Jobs have no folders.
Actions: list, get, create, update, delete.
list returns id, name, description, cron, enabled.
get needs id. It returns name, schedule, and timeoutMs. It does not return source.
create needs name. Optional description, body.cron (5-field), body.timeoutMs. Does not accept code. The starter is live right away.
update needs id. It can change name, description, body.cron, and body.timeoutMs. It does not change the script.
delete needs id. List first.
Script changes go through nonla_get_job_code, nonla_edit_job_code and nonla_run_job. Every edit changes the live job, and nonla_run_job runs the live job.`,
      schema: MANAGE_SCHEMA,
    },
  );
}

const idSchema = z.object({ id: z.string().describe("Job id") });

export function makeGetJobCodeTool(): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const id = requireId(input);
        const code = await getJobCode(id);
        if (code == null) return fail("Job not found");
        return ok({ id, code });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_get_job_code",
      description: "Read a job's live TypeScript script. Call this before nonla_edit_job_code so old_string matches the file. Returns the source in result.code.",
      schema: idSchema,
    },
  );
}

const editHunkSchema = z.object({
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

const editSchema = z
  .object({
    id: z.string(),
    mode: z.enum(["replace", "full"]),
    code: z.string().optional(),
    edits: z.array(editHunkSchema).optional(),
    summary: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "full") {
      if (typeof val.code !== "string") ctx.addIssue({ code: "custom", message: "mode=full requires code", path: ["code"] });
    } else if (!val.edits || val.edits.length === 0) {
      ctx.addIssue({ code: "custom", message: "mode=replace requires edits", path: ["edits"] });
    }
  });

export function makeEditJobCodeTool(): StructuredToolInterface {
  return tool(
    async (input) => {
      const parsed = editSchema.safeParse(input);
      if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
      const { id, mode, code, edits, summary } = parsed.data;
      try {
        let next: string;
        if (mode === "full") {
          next = normalizeToLf(code!);
        } else {
          const current = (await getJobCode(id)) ?? "";
          if (!current.trim()) return fail('Source is empty. Use mode="full" to write the whole script.');
          const applied = applyEdits(current, edits as EditHunk[]);
          if (!applied.ok) return fail(applied.hint ? `${applied.error}. ${applied.hint}` : applied.error);
          next = applied.content;
        }
        if (editPayloadIsOmitted(next, edits)) return fail(OMITTED_EDIT_TOOL_ERROR.error);
        await saveJobCode(id, next);
        return ok({ id, mode, message: summary ?? "Job updated." });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_edit_job_code",
      description: 'Edit a job script by id. mode="replace": exact edits[{ old_string, new_string }]. mode="full": replace the whole file with code. No markdown fences. Call nonla_get_job_code first. The edit goes live at once. Then call nonla_run_job.',
      schema: editSchema,
    },
  );
}

const RUN_POLL_MS = 1000;
const RUN_WAIT_CAP_MS = 120_000;

export function makeRunJobTool(): StructuredToolInterface {
  return tool(
    async (input: { id?: string }) => {
      try {
        const id = requireId(input);
        const job = await getJob(id);
        if (!job) return fail("Job not found");
        const started = await runLiveJobCode(id);
        if (!started.started || !started.runId) return fail(started.error ?? "Run did not start");
        const limit = Math.min(RUN_WAIT_CAP_MS, (job.timeoutMs ?? RUN_WAIT_CAP_MS) + 5000);
        const deadline = Date.now() + limit;
        while (Date.now() < deadline) {
          const run = await getJobRun(started.runId);
          if (run && run.status !== "running") {
            const pub = toPublicJobRun(run);
            return ok({ success: pub.status === "success", runId: pub.id, status: pub.status, error: pub.error, startedAt: pub.startedAt, finishedAt: pub.finishedAt, logs: pub.logs });
          }
          await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS));
        }
        return ok({ success: false, runId: started.runId, status: "running", error: `Still running after ${Math.round(limit / 1000)}s` });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_run_job",
      description: "Run a job's live script once by job id, the same as a manual Run, and wait for it to finish. Returns success, status, error and logs. The run can have real side effects such as writes and messages. Call this after nonla_edit_job_code.",
      schema: idSchema,
    },
  );
}

export function makeJobAdminTools(): StructuredToolInterface[] {
  return [makeManageJobsTool(), makeGetJobCodeTool(), makeEditJobCodeTool(), makeRunJobTool()];
}
