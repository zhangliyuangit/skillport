#!/usr/bin/env node
import { homedir } from "node:os";
import path from "node:path";
import {
  AgentAdapter,
  SkillPortService,
  StateStore
} from "@skillport/core";
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

process.exitCode = await runCli(process.argv.slice(2), {
  service,
  stdout: process.stdout,
  stderr: process.stderr
});
