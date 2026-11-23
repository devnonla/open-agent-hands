# Jobs

A job is a Bun/TypeScript script run on a cron schedule. It is a plain script with top-level `await`, not a function. Import the SDK and write the work.

Name the job with a readable title in plain words, e.g. `Sync GitHub issues` or `Daily sales report`, not `sync-github-issues`. Put what it does and why in `description`, one short sentence. People read both in the jobs list.

```ts
import agenthands from "@agenthands/runtime";

const since = agenthands.run.lastSuccessAt ?? "2026-01-01T00:00:00Z";
const issues = await agenthands.step("Fetch", () => fetchIssues(since), { retries: 3 });
await agenthands.step("Save", () => agenthands.datatable.insert("crm", "issues", issues));
agenthands.log.info("synced", { count: issues.length });
agenthands.output({ synced: issues.length });
```

## Steps and logs
- `agenthands.step(name, fn, { retries?, backoffMs? })` runs `fn`, returns its value, and shows as one bar in the run trace with its duration. A thrown error fails the step and the run.
- `retries` (0-10) re-runs only that step, waiting `backoffMs × 2^n` (default 1000 ms). Use it for flaky network calls.
- Keep steps coarse: fetch, transform, save. Do not wrap every call.
- `agenthands.log.info / warn / error(message, data?)` write run logs. `data` is any JSON value. `console.log` also works.
- kv, secrets and datatables work as in [runtime.md](runtime.md).
- Throw to fail the run. Exit normally to succeed.

## Run context: `agenthands.run`
- `id`, `jobId`, `jobName`, `trigger` (`"cron"` or `"manual"`), `attempt`, `maxAttempts`.
- `scheduledFor`: the planned cron time (ISO) for scheduled runs, else `null`.
- `lastSuccessAt`: when the last successful run finished (ISO), or `null`. Use it to process only new data.
- `input`: the JSON passed to `run_job` `input`, else `null`.

## Output
- `agenthands.output(value)` records a JSON result on the run, up to 256 KB. The last call wins.
- `run_job wait=true` and `get_job_runs` return it as `output`. Put large data in a datatable and output a summary.

## Schedule
- `cron`: 5 fields (`min hour day-of-month month day-of-week`), several expressions separated by new lines, in the app timezone. Empty cron means manual only.
- An invalid cron is rejected. `enabled=true` with no cron is rejected.
- `create_job`, `update_job`, `list_jobs` and `get_job` return `status` (`scheduled`, `paused` or `manual`) and `nextRuns` (the next 3 times, ISO). Check them against what the user asked for.
- A person can pause a job in the UI. A paused job keeps its cron and stays paused when you change the cron. Pass `enabled=true` to resume, only when the user asked. `enabled=false` pauses.

## Running
- `timeout_ms` caps one attempt. Default 300000 (5 minutes).
- `max_retries` (0-5, default 0) re-runs the whole script when it fails or times out, waiting 5 s, 10 s, 20 s… between attempts. Use it only when the script is safe to run twice. Otherwise retry inside a step.
- A job never overlaps itself. `run_job` fails with "Job is already running" while a run is queued or running.
- Up to 3 runs execute at the same time. Others wait with status `queued`.
- `run_job` takes an optional `input` (any JSON, up to 64 KB) and returns right away. With `wait=true` it waits up to 120 seconds and returns the run with `status`, `attempts`, `output`, `error` and logs. If it is still running after that, call `get_job_runs`.
- `get_job_runs` returns recent runs (default 5). Read them after every change to confirm it works.
- `clear_job_runs` with `confirm=true` deletes the finished run history of a job. Queued and running runs stay. Use it only when the user asks.
- Run it once with `run_job wait=true` before telling the user a job is done.
- Config agents write (cron, code, timeout, retries) is read-only in the UI. People pause, resume, start runs and clear run history.
