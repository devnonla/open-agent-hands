# Jobs

A job is a Bun/TypeScript script run on a cron schedule. It is a plain script with top-level `await`, not a function. Import the SDK and write the work.

```ts
import agenthands from "@agenthands/runtime";

await agenthands.step("Count", async () => {
  const count = Number(await agenthands.kv.get("RUN_COUNT", "0")) + 1;
  await agenthands.kv.set("RUN_COUNT", String(count));
  agenthands.log.info(`run #${count}`);
});
```

- `agenthands.step(name, fn)` groups logs and records duration and failure. A thrown error fails the step and the run.
- `agenthands.log.info / warn / error(message)` write run logs. `console.log` also works.
- kv, secrets and datatables work as in [runtime.md](runtime.md).
- Throw to fail the run. Exit normally to succeed.

## Schedule
- `cron`: 5 fields (`min hour day-of-month month day-of-week`), several expressions separated by new lines, in the app timezone. Empty cron means manual only.
- An invalid cron is rejected. `enabled=true` with no cron is rejected.
- `create_job`, `update_job`, `list_jobs` and `get_job` return `status` (`scheduled`, `paused` or `manual`) and `nextRuns` (the next 3 times, ISO). Check them against what the user asked for.
- A person can pause a job in the UI. A paused job keeps its cron and stays paused when you change the cron. Pass `enabled=true` to resume, only when the user asked. `enabled=false` pauses.

## Running
- `timeout_ms` caps a run. Default 300000 (5 minutes).
- Up to 3 jobs run at the same time. `run_job` fails with "Job is already running" if that job is running.
- `run_job` returns right away. With `wait=true` it waits up to 120 seconds and returns the run with logs. If it is still running after that, call `get_job_runs`.
- `get_job_runs` returns recent runs with logs (default 5). Read them after every change to confirm it works.
- Run it once with `run_job wait=true` before telling the user a job is done.
- Config agents write (cron, code) is read-only in the UI. People only pause and resume.
