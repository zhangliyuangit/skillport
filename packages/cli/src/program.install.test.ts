import { expect, it } from "vitest";
import { runCli, type CliService } from "./program.js";

function writer() {
  let text = "";
  return { write: (chunk: string) => { text += chunk; }, text: () => text };
}

it("passes a GitHub URL and subdirectory to install", async () => {
  let received: unknown[] = [];
  const service = {
    scan: async () => [],
    add: async () => { throw new Error("unused"); },
    install: async (...args: unknown[]) => {
      received = args;
      return {
        kind: "completed" as const,
        name: "pdf",
        agents: { codex: "symlink" as const, claude: "symlink" as const }
      };
    },
    diff: async () => ({ name: "", text: "", truncated: false }),
    status: async () => [],
    sync: async () => { throw new Error("unused"); },
    remove: async () => ({ kind: "completed" as const, name: "" }),
    list: async () => []
  } satisfies CliService;
  const stdout = writer();
  const exitCode = await runCli(
    ["install", "https://github.com/acme/skills", "--path", "skills/pdf"],
    { service, stdout, stderr: writer() }
  );
  expect(exitCode).toBe(0);
  expect(received).toEqual([
    "https://github.com/acme/skills",
    "skills/pdf",
    undefined
  ]);
  expect(stdout.text()).toContain("pdf is now managed");
});
