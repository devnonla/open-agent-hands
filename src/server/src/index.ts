import rootPkg from "../../../package.json" with { type: "json" };
import { closeDb, initDb } from "./common/db/client.js";
import { migrateLegacyDataLayout } from "./common/workspace/legacy-layout.js";
import { getDataDir } from "./common/utils/data-dir.js";
import { createAppServer } from "./common/ws/create-app-server.js";
import { startJobsScheduler, stopJobsScheduler } from "./modules/jobs/jobs-scheduler.js";
import { SITE_WORKER_FLAG } from "./modules/sites/sites-backend-runner.js";
import { runSiteBackendWorker } from "./modules/sites/sites-backend-worker.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  dataDir?: string;
}

export async function startServer(options: ServerOptions = {}): Promise<void> {
  const port = options.port ?? Number(process.env.PORT ?? "8429");
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const dataDir = options.dataDir ?? getDataDir();

  process.env.DATA_DIR = dataDir;
  await initDb(dataDir);
  await migrateLegacyDataLayout();
  startJobsScheduler();

  const server = createAppServer({ port, host });
  console.log(`agenthands ${rootPkg.version} listening on http://${host}:${server.port} (data: ${dataDir})`);

  const shutdown = async () => {
    stopJobsScheduler();
    await closeDb();
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const HELP = `agenthands — Agent Hands: local tools, MCP, KV and datatables server

Usage: agenthands [options]

Options:
  -p, --port <port>      HTTP port (default 8429, env PORT)
  -H, --host <host>      Bind address (default 127.0.0.1, env HOST)
  -d, --data-dir <dir>   Data directory (default ~/.open-agent-hands, env DATA_DIR)
  -v, --version          Print version
  -h, --help             Show this help`;

function parseArgs(argv: string[]): ServerOptions | null {
  const options: ServerOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      return null;
    }
    if (arg === "-v" || arg === "--version") {
      console.log(rootPkg.version);
      return null;
    }
    if (arg === "-p" || arg === "--port") options.port = Number(value());
    else if (arg === "-H" || arg === "--host") options.host = value();
    else if (arg === "-d" || arg === "--data-dir") options.dataDir = value();
    else throw new Error(`Unknown option: ${arg}\n\n${HELP}`);
  }
  return options;
}

if (import.meta.main && process.argv[2] === SITE_WORKER_FLAG) {
  runSiteBackendWorker();
} else if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options) await startServer(options);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
