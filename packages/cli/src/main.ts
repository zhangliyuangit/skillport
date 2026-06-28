#!/usr/bin/env node
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import {
  AgentAdapter,
  ConfigStore,
  SkillPortService,
  StateStore
} from "@skillport/core";
import { startServer, type RunningServer } from "@skillport/server";
import { runCli } from "./program.js";

const home = homedir();
const root = process.env.SKILLPORT_HOME ?? path.join(home, ".skillport");
const configStore = new ConfigStore(root, [
  { id: "codex", root: path.join(home, ".codex", "skills") },
  { id: "claude", root: path.join(home, ".claude", "skills") }
]);
const agentConfigs = await configStore.list();
const service = new SkillPortService({
  root,
  stateStore: new StateStore(root),
  agents: agentConfigs.map((agent) => new AgentAdapter(agent.id, agent.root))
});
let running: RunningServer | undefined;

// Adds/removes update the config file and re-point the live service so a
// running `skillport ui` reflects the change without a restart.
const agentAdmin = {
  list: () => configStore.list(),
  add: async (id: string, agentRoot: string) => {
    const next = await configStore.add(id, agentRoot);
    service.setAgents(next.map((agent) => new AgentAdapter(agent.id, agent.root)));
    return next;
  },
  remove: async (id: string) => {
    const next = await configStore.remove(id);
    service.setAgents(next.map((agent) => new AgentAdapter(agent.id, agent.root)));
    return next;
  },
  populate: (id: string) => service.populate(id)
};

process.exitCode = await runCli(process.argv.slice(2), {
  service,
  stdout: process.stdout,
  stderr: process.stderr,
  agents: agentAdmin,
  startUi: async () => {
    const webRoot = fileURLToPath(new URL("./web", import.meta.url));
    running = await startServer({
      service,
      agents: agentAdmin,
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
