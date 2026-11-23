import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { finishJobRun, getJob, getJobRun, toPublicJobRun, tryClaimJob } from "../modules/jobs/jobs.service.js";

const toPublic = toPublicJobRun;
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

async function waitForRun(runId: string, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await getJobRun(runId);
    if (run && run.status !== "running" && run.status !== "queued") return run;
    await Bun.sleep(50);
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms`);
}

describe("Jobs API", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;
  let jobId: string;

  beforeAll(async () => {
    process.env.ENABLE_SCHEDULER = "false";
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    const admin = await setupAdmin(app);
    token = admin.token;
  });

  afterAll(() => cleanup());

  test("POST /api/jobs — create job", async () => {
    const res = await authRequest(app, token, "POST", "/api/jobs", {
      name: "Daily ping",
      cron: "0 9 * * *",
      code: `import agenthands from "@agenthands/runtime";
await agenthands.step("hello", async () => {
  agenthands.log.info("hello from job");
});
`,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string; name: string; cron: string; enabled: boolean; nextRunAt: string | null };
    expect(data.name).toBe("Daily ping");
    expect(data.cron).toBe("0 9 * * *");
    expect(data.enabled).toBe(true);
    expect(data.nextRunAt).toBeTruthy();
    jobId = data.id;
  });

  test("POST /api/jobs — invalid cron", async () => {
    const res = await authRequest(app, token, "POST", "/api/jobs", {
      name: "Bad",
      cron: "not-a-cron",
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/jobs — multi-line cron stores normalized field", async () => {
    const res = await authRequest(app, token, "POST", "/api/jobs", {
      name: "Multi schedule",
      cron: "0 8 * * 1\n0 9 * * 2",
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string; cron: string; enabled: boolean; nextRunAt: string | null };
    expect(data.cron).toBe("0 8 * * 1\n0 9 * * 2");
    expect(data.enabled).toBe(true);
    expect(data.nextRunAt).toBeTruthy();

    await authRequest(app, token, "DELETE", `/api/jobs/${data.id}`);
  });

  test("PUT /api/jobs/:id — multi-line cron with one invalid rejects", async () => {
    const create = await authRequest(app, token, "POST", "/api/jobs", {
      name: "Temp multi",
      cron: "0 9 * * *",
    });
    const created = (await create.json()) as { id: string };
    const res = await authRequest(app, token, "PUT", `/api/jobs/${created.id}`, {
      cron: "0 8 * * 1\nnot-a-cron",
    });
    expect(res.status).toBe(400);
    await authRequest(app, token, "DELETE", `/api/jobs/${created.id}`);
  });

  test("GET /api/jobs — list", async () => {
    const res = await authRequest(app, token, "GET", "/api/jobs");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { id: string }[]; total: number };
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.items.some((j) => j.id === jobId)).toBe(true);
  });

  test("GET /api/jobs/:id — get one", async () => {
    const res = await authRequest(app, token, "GET", `/api/jobs/${jobId}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string; code: string };
    expect(data.id).toBe(jobId);
    expect(data.code).toContain("hello from job");
  });

  test("PUT /api/jobs/:id — clear cron turns job off", async () => {
    const res = await authRequest(app, token, "PUT", `/api/jobs/${jobId}`, { cron: "" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { enabled: boolean; nextRunAt: string | null; cron: string };
    expect(data.cron).toBe("");
    expect(data.enabled).toBe(false);
    expect(data.nextRunAt).toBeNull();

    const on = await authRequest(app, token, "PUT", `/api/jobs/${jobId}`, { cron: "0 9 * * *" });
    expect(on.status).toBe(200);
    const enabled = (await on.json()) as { enabled: boolean; nextRunAt: string | null };
    expect(enabled.enabled).toBe(true);
    expect(enabled.nextRunAt).toBeTruthy();
  });

  test("PUT /api/jobs/:id — pause keeps cron, survives cron change, resumes", async () => {
    type J = { enabled: boolean; cron: string; status: string; nextRuns: string[]; nextRunAt: string | null };
    const paused = (await (await authRequest(app, token, "PUT", `/api/jobs/${jobId}`, { enabled: false })).json()) as J;
    expect(paused.enabled).toBe(false);
    expect(paused.cron).toBe("0 9 * * *");
    expect(paused.status).toBe("paused");
    expect(paused.nextRuns).toEqual([]);

    const changed = (await (await authRequest(app, token, "PUT", `/api/jobs/${jobId}`, { cron: "30 8 * * 1-5" })).json()) as J;
    expect(changed.cron).toBe("30 8 * * 1-5");
    expect(changed.enabled).toBe(false);

    const resumed = (await (await authRequest(app, token, "PUT", `/api/jobs/${jobId}`, { enabled: true })).json()) as J;
    expect(resumed.enabled).toBe(true);
    expect(resumed.status).toBe("scheduled");
    expect(resumed.nextRuns).toHaveLength(3);
    expect(new Date(resumed.nextRuns[0]).getTime()).toBeLessThan(new Date(resumed.nextRuns[1]).getTime());

    const restore = await authRequest(app, token, "PUT", `/api/jobs/${jobId}`, { cron: "0 9 * * *" });
    expect(restore.status).toBe(200);
  });

  test("PUT /api/jobs/:id — enabling a job without cron fails", async () => {
    const created = (await (await authRequest(app, token, "POST", "/api/jobs", { name: "Manual only", cron: "" })).json()) as { id: string; status: string };
    expect(created.status).toBe("manual");
    const res = await authRequest(app, token, "PUT", `/api/jobs/${created.id}`, { enabled: true });
    expect(res.status).toBe(400);
    await authRequest(app, token, "DELETE", `/api/jobs/${created.id}`);
  });

  test("POST /api/jobs/:id/run — manual run executes code", async () => {
    const res = await authRequest(app, token, "POST", `/api/jobs/${jobId}/run`, {});
    expect(res.status).toBe(202);
    const run = (await res.json()) as { id: string; status: string; trigger: string };
    expect(run.trigger).toBe("manual");
    expect(run.status).toBe("queued");

    const done = await waitForRun(run.id);
    expect(done.status).toBe("success");
    const logs = typeof done.logs === "string" ? done.logs : JSON.stringify(done.logs);
    expect(logs).toContain("hello from job");
    expect(logs).toContain('"kind":"step"');
  });

  test("POST /api/jobs/:id/run — overlap blocked while lease held", async () => {
    const claimed = await (tryClaimJob(jobId, "manual"));
    expect(claimed).not.toBeNull();

    const res = await authRequest(app, token, "POST", `/api/jobs/${jobId}/run`, {});
    expect(res.status).toBe(400);

    await finishJobRun({
      jobId,
      runId: claimed!.run.id,
      status: "success",
      logs: [{ t: 0, level: "info", message: "skipped" }],
      advanceSchedule: false,
    });
  });

  test("tryClaimJob — only one winner", async () => {
    const a = await (tryClaimJob(jobId, "manual"));
    expect(a).not.toBeNull();
    const b = await (tryClaimJob(jobId, "manual"));
    expect(b).toBeNull();
    await finishJobRun({
      jobId,
      runId: a!.run.id,
      status: "success",
      logs: [],
      advanceSchedule: false,
    });
  });

  test("GET /api/jobs/:id/runs — list runs", async () => {
    const res = await authRequest(app, token, "GET", `/api/jobs/${jobId}/runs`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { logs: { t: number; message: string }[] }[]; total: number };
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.items[0]?.logs)).toBe(true);
  });

  test("manual run with legacy nonlaagents import", async () => {
    const update = await authRequest(app, token, "PUT", `/api/jobs/${jobId}`, {
      code: `import agenthands from "nonlaagents";
await agenthands.step("kv check", async () => {
  await agenthands.kv.set("JOB_TEST", "ok");
  const v = await agenthands.kv.get("JOB_TEST");
  agenthands.log.info("kv=" + v);
});
`,
    });
    expect(update.status).toBe(200);

    const res = await authRequest(app, token, "POST", `/api/jobs/${jobId}/run`, {});
    expect(res.status).toBe(202);
    const run = (await res.json()) as { id: string };
    const done = await waitForRun(run.id);
    expect(done.status).toBe("success");
    const logs = typeof done.logs === "string" ? done.logs : JSON.stringify(done.logs);
    expect(logs).toContain("kv=ok");
  });

  test("POST /api/jobs/:id/runs/:runId/cancel — stops running job", async () => {
    const create = await authRequest(app, token, "POST", "/api/jobs", {
      name: "Slow cancel",
      cron: "",
      code: "await Bun.sleep(60_000);",
    });
    expect(create.status).toBe(201);
    const slow = (await create.json()) as { id: string };

    const res = await authRequest(app, token, "POST", `/api/jobs/${slow.id}/run`, {});
    expect(res.status).toBe(202);
    const run = (await res.json()) as { id: string; status: string };
    expect(run.status).toBe("queued");
    for (let i = 0; i < 100 && (await getJobRun(run.id))?.status !== "running"; i++) await Bun.sleep(20);
    expect((await getJobRun(run.id))?.status).toBe("running");

    const cancel = await authRequest(app, token, "POST", `/api/jobs/${slow.id}/runs/${run.id}/cancel`, {});
    expect(cancel.status).toBe(200);

    const done = await waitForRun(run.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("Cancelled");

    await authRequest(app, token, "DELETE", `/api/jobs/${slow.id}`);
  });

  test("run input, output and run context reach the script", async () => {
    const create = await authRequest(app, token, "POST", "/api/jobs", {
      name: "io job",
      code: `import agenthands from "@agenthands/runtime";
const doubled = await agenthands.step("Double", () => agenthands.run.input.n * 2);
agenthands.log.info("context", { trigger: agenthands.run.trigger, attempt: agenthands.run.attempt, last: agenthands.run.lastSuccessAt });
agenthands.output({ doubled, jobName: agenthands.run.jobName });
`,
    });
    const job = (await create.json()) as { id: string };
    const res = await authRequest(app, token, "POST", `/api/jobs/${job.id}/run`, { input: { n: 21 } });
    expect(res.status).toBe(202);
    const done = toPublic(await waitForRun(((await res.json()) as { id: string }).id));
    expect(done.status).toBe("success");
    expect(done.input).toEqual({ n: 21 });
    expect(done.output).toEqual({ doubled: 42, jobName: "io job" });
    const context = done.logs.find((e) => e.message === "context");
    expect(context?.data).toEqual({ trigger: "manual", attempt: 1, last: null });
    const step = done.logs.find((e) => e.kind === "step" && e.duration != null);
    const stepStart = done.logs.find((e) => e.kind === "step" && e.duration == null);
    expect(step).toBeDefined();
    expect(stepStart).toBeDefined();
    expect(step?.t).toBe(stepStart?.t as number);

    const second = await authRequest(app, token, "POST", `/api/jobs/${job.id}/run`, { input: { n: 1 } });
    const again = toPublic(await waitForRun(((await second.json()) as { id: string }).id));
    expect((again.logs.find((e) => e.message === "context")?.data as { last: string | null }).last).not.toBeNull();
    await authRequest(app, token, "DELETE", `/api/jobs/${job.id}`);
  });

  test("step retries recover and a failed step records its error", async () => {
    const create = await authRequest(app, token, "POST", "/api/jobs", {
      name: "flaky steps",
      code: `import agenthands from "@agenthands/runtime";
let tries = 0;
await agenthands.step("Flaky", () => { tries++; if (tries < 3) throw new Error("nope " + tries); return tries; }, { retries: 3, backoffMs: 10 });
await agenthands.step("Broken", () => { throw new Error("database is down"); });
`,
    });
    const job = (await create.json()) as { id: string };
    const res = await authRequest(app, token, "POST", `/api/jobs/${job.id}/run`, {});
    const done = toPublic(await waitForRun(((await res.json()) as { id: string }).id));
    expect(done.status).toBe("failed");
    const flaky = done.logs.find((e) => e.kind === "step" && e.message === "Flaky" && e.duration != null);
    expect(flaky?.level).toBe("step");
    expect(flaky?.attempts).toBe(3);
    expect(done.logs.filter((e) => e.level === "warn" && e.message.startsWith("Flaky failed")).length).toBe(2);
    const broken = done.logs.find((e) => e.kind === "step" && e.message === "Broken" && e.duration != null);
    expect(broken?.level).toBe("error");
    expect(broken?.error).toBe("database is down");
    expect(done.logs.some((e) => e.message.includes("\u001b["))).toBe(false);
    await authRequest(app, token, "DELETE", `/api/jobs/${job.id}`);
  });

  test("max_retries re-runs the whole script until it succeeds", async () => {
    const create = await authRequest(app, token, "POST", "/api/jobs", {
      name: "retry job",
      maxRetries: 2,
      code: `import agenthands from "@agenthands/runtime";
if (agenthands.run.attempt < 2) throw new Error("first attempt fails");
agenthands.output({ attempt: agenthands.run.attempt, max: agenthands.run.maxAttempts });
`,
    });
    const job = (await create.json()) as { id: string; maxRetries: number };
    expect(job.maxRetries).toBe(2);
    const res = await authRequest(app, token, "POST", `/api/jobs/${job.id}/run`, {});
    const done = toPublic(await waitForRun(((await res.json()) as { id: string }).id, 30_000));
    expect(done.status).toBe("success");
    expect(done.attempts).toBe(2);
    expect(done.output).toEqual({ attempt: 2, max: 3 });
    expect(done.logs.some((e) => e.message.startsWith("Attempt 1 failed"))).toBe(true);
    expect(done.logs.some((e) => e.message === "Attempt 2 of 3")).toBe(true);
    await authRequest(app, token, "DELETE", `/api/jobs/${job.id}`);
  }, 40_000);

  test("DELETE /api/jobs/:id/runs clears finished runs only", async () => {
    const active = await (tryClaimJob(jobId, "manual"));
    expect(active).not.toBeNull();
    const before = (await (await authRequest(app, token, "GET", `/api/jobs/${jobId}/runs`)).json()) as { total: number };
    expect(before.total).toBeGreaterThan(1);

    const res = await authRequest(app, token, "DELETE", `/api/jobs/${jobId}/runs`);
    expect(res.status).toBe(200);
    const result = (await res.json()) as { deleted: number; kept: number };
    expect(result.deleted).toBe(before.total - 1);
    expect(result.kept).toBe(1);

    const after = (await (await authRequest(app, token, "GET", `/api/jobs/${jobId}/runs`)).json()) as { items: { id: string }[]; total: number };
    expect(after.total).toBe(1);
    expect(after.items[0].id).toBe(active!.run.id);
    await finishJobRun({ jobId, runId: active!.run.id, status: "success", logs: [], advanceSchedule: false });
  });

  test("max_retries out of range is rejected", async () => {
    const res = await authRequest(app, token, "POST", "/api/jobs", { name: "bad retries", code: "", maxRetries: 9 });
    expect(res.status).toBe(400);
    const update = await authRequest(app, token, "PUT", `/api/jobs/${jobId}`, { maxRetries: -1 });
    expect(update.status).toBe(400);
  });

  test("DELETE /api/jobs/:id", async () => {
    const res = await authRequest(app, token, "DELETE", `/api/jobs/${jobId}`);
    expect(res.status).toBe(200);
    expect(await (getJob(jobId))).toBeUndefined();
  });
});
