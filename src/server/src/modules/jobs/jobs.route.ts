import { Hono } from "hono";
import { BadRequestException } from "../../common/exceptions/http.exception.js";
import { requireAuth } from "../../common/middleware/auth.middleware.js";
import { cancelJobRun, startClaimedRun } from "./jobs-runner.js";
import { createJob, deleteJob, getJob, getJobRun, listJobRuns, listJobs, toPublicJob, toPublicJobRun, tryClaimJob, updateJob } from "./jobs.service.js";

const app = new Hono();

app.use("*", requireAuth);

app.use("/:id/*", async (c, next) => {
  if (!(await getJob(c.req.param("id")))) throw new BadRequestException("Job not found");
  await next();
});

app.get("/", async (c) => c.json(await listJobs(c.req.query())));

app.get("/:id", async (c) => {
  const job = await getJob(c.req.param("id"));
  if (!job) throw new BadRequestException("Job not found");
  return c.json(toPublicJob(job));
});

app.post("/", async (c) => {
  const body = await c.req.json();
  return c.json(await createJob(body), 201);
});

app.put("/:id", async (c) => {
  const body = await c.req.json();
  return c.json(await updateJob(c.req.param("id"), body));
});

app.delete("/:id", async (c) => {
  await deleteJob(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/:id/runs", async (c) => {
  return c.json(await listJobRuns(c.req.param("id"), c.req.query()));
});

app.get("/:id/runs/:runId", async (c) => {
  const run = await getJobRun(c.req.param("runId"));
  if (!run || run.jobId !== c.req.param("id")) throw new BadRequestException("Run not found");
  return c.json(toPublicJobRun(run));
});

app.post("/:id/run", async (c) => {
  const jobId = c.req.param("id");
  const job = await getJob(jobId);
  if (!job) throw new BadRequestException("Job not found");

  const claimed = await tryClaimJob(jobId, "manual");
  if (!claimed) {
    throw new BadRequestException("Job is already running or could not be claimed");
  }

  startClaimedRun(claimed.job.id, claimed.run.id, false);
  return c.json(claimed.run, 202);
});

app.post("/:id/runs/:runId/cancel", async (c) => {
  return c.json(await cancelJobRun(c.req.param("id"), c.req.param("runId")));
});

export default app;
