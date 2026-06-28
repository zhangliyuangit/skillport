#!/usr/bin/env node
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import {
  AgentAdapter,
  SkillPortService,
  StateStore
} from "@skillport/core";
import { startServer, type RunningServer } from "@skillport/server";
import { runCli } from "./program.js";

const home = homedir();
const root = process.env.SKILLPORT_HOME ?? path.join(home, ".skillport");
const service = new SkillPortService({
  root,
  stateStore: new StateStore(root),
  agents: [
    new AgentAdapter("codex", path.join(home, ".codex", "skills")),
    new AgentAdapter("claude", path.join(home, ".claude", "skills"))
  ]
});
let running: RunningServer | undefined;

process.exitCode = await runCli(process.argv.slice(2), {
  service,
  stdout: process.stdout,
  stderr: process.stderr,
  startUi: async () => {
    const webRoot = fileURLToPath(new URL("./web", import.meta.url));
    running = await startServer({
      service,
      webRoot,
      ...(process.env.SKILLPORT_NO_OPEN === "1"
        ? {}
        : { openBrowser: async (url: string) => { await open(url); } })
    });
    return running.url;
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void running?.close().finally(() => process.exit(0));
  });
}
