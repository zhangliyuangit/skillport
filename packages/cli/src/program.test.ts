import { describe, expect, it } from "vitest";
import { runCli, type CliService } from "./program.js";

function output() {
  let value = "";
  return {
    write(chunk: string) {
      value += chunk;
    },
    text() {
      return value;
    }
  };
}

function fakeService(overrides: Partial<CliService> = {}): CliService {
  return {
    scan: async () => [],
    add: async (name) => ({
      kind: "completed",
      name,
      agents: { codex: "symlink", claude: "symlink" }
    }),
    diff: async (name) => ({ name, text: "no difference", truncated: false }),
    status: async () => [],
    sync: async (name) => ({
      kind: "completed",
      name,
      agents: { codex: "symlink", claude: "symlink" }
    }),
    remove: async (name) => ({ kind: "completed", name }),
    list: async () => [],
    ...overrides
  };
}

describe("runCli", () => {
  it("renders scan results", async () => {
    const stdout = output();
    const exitCode = await runCli(["scan"], {
      service: fakeService({
        scan: async () => [
          { name: "pdf", classification: "single-source", agents: ["codex"] }
        ]
      }),
      stdout,
      stderr: output()
    });
    expect(exitCode).toBe(0);
    expect(stdout.text()).toContain("pdf");
    expect(stdout.text()).toContain("single-source");
  });

  it("returns 2 and prints source commands when add needs a decision", async () => {
    const stdout = output();
    const exitCode = await runCli(["add", "review"], {
      service: fakeService({
        add: async () => ({
          kind: "decision-required",
          name: "review",
          choices: ["codex", "claude"]
        })
      }),
      stdout,
      stderr: output()
    });
    expect(exitCode).toBe(2);
    expect(stdout.text()).toContain("skillport add review --from codex");
    expect(stdout.text()).toContain("skillport add review --from claude");
  });

  it("returns 4 when status requires attention", async () => {
    const exitCode = await runCli(["status"], {
      service: fakeService({
        status: async () => [
          {
            name: "pdf",
            overall: "Local changes",
            agents: { codex: "linked", claude: "local changes" }
          }
        ]
      }),
      stdout: output(),
      stderr: output()
    });
    expect(exitCode).toBe(4);
  });

  it("returns 3 for an invalid source option", async () => {
    const stderr = output();
    const exitCode = await runCli(["add", "pdf", "--from", "cursor"], {
      service: fakeService(),
      stdout: output(),
      stderr
    });
    expect(exitCode).toBe(3);
    expect(stderr.text()).toContain("codex or claude");
  });

  it("returns 1 and reports operational errors", async () => {
    const stderr = output();
    const exitCode = await runCli(["remove", "pdf"], {
      service: fakeService({ remove: async () => { throw new Error("permission denied"); } }),
      stdout: output(),
      stderr
    });
    expect(exitCode).toBe(1);
    expect(stderr.text()).toContain("permission denied");
  });
});
