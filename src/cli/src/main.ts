#!/usr/bin/env node
import { processIo, runCli } from "./cli.js";

declare const AH_VERSION: string | undefined;

process.exitCode = await runCli(process.argv.slice(2), processIo(typeof AH_VERSION === "string" ? AH_VERSION : "dev"));
