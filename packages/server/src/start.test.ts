import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startServer } from "./start.js";
import type { ApiService } from "./app.js";

const service: ApiService = {
  scan: async () => [],
  list: async () => [],
  status: async () => [],
  diff: async (name) => ({ name, text: "", truncated: false }),
  preview: async (name) => ({ name, text: "", truncated: false }),
  add: async (name) => ({
    kind: "completed",
    name,
    agents: { codex: "symlink", claude: "symlink" }
  }),
  install: async () => ({
    kind: "completed",
    name: "installed",
    agents: { codex: "symlink", claude: "symlink" }
  }),
  sync: async (name) => ({
    kind: "completed",
    name,
    agents: { codex: "symlink", claude: "symlink" }
  }),
  enable: async (name) => ({ kind: "completed", name }),
  disable: async (name) => ({ kind: "completed", name }),
  deleteSkill: async (agent, name) => ({ kind: "completed", name, agent }),
  remove: async (name) => ({ kind: "completed", name }),
  doctor: async () => [],
  repair: async () => ({ fixed: 0, remaining: [] })
};

it("binds to loopback with an ephemeral port and tokenized URL", async () => {
  const webRoot = await mkdtemp(path.join(os.tmpdir(), "skillport-web-"));
  await mkdir(webRoot, { recursive: true });
  await writeFile(path.join(webRoot, "index.html"), "<h1>SkillPort</h1>");
  const opened: string[] = [];
  const running = await startServer({
    service,
    webRoot,
    openBrowser: async (url) => {
      opened.push(url);
    }
  });
  expect(running.host).toBe("127.0.0.1");
  expect(running.port).toBeGreaterThan(0);
  expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{64}$/);
  expect(opened).toEqual([running.url]);
  expect(await (await fetch(`http://${running.host}:${running.port}/`)).text()).toContain(
    "SkillPort"
  );
  await running.close();
});
