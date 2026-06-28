import { expect, it } from "vitest";
import { startServer } from "./start.js";
import type { ApiService } from "./app.js";

const service: ApiService = {
  scan: async () => [],
  list: async () => [],
  status: async () => [],
  diff: async (name) => ({ name, text: "", truncated: false }),
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
  remove: async (name) => ({ kind: "completed", name })
};

it("binds to loopback with an ephemeral port and tokenized URL", async () => {
  const opened: string[] = [];
  const running = await startServer({
    service,
    openBrowser: async (url) => {
      opened.push(url);
    }
  });
  expect(running.host).toBe("127.0.0.1");
  expect(running.port).toBeGreaterThan(0);
  expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{64}$/);
  expect(opened).toEqual([running.url]);
  await running.close();
});
