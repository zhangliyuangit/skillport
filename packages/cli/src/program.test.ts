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
    install: async (_url, _path, _from) => ({
      kind: "completed",
      name: "installed",
      agents: { codex: "symlink", claude: "symlink" }
    }),
    diff: async (name) => ({ name, text: "no difference", truncated: false }),
    status: async () => [],
    sync: async (name) => ({
      kind: "completed",
      name,
      agents: { codex: "symlink", claude: "symlink" }
    }),
    enable: async (name) => ({ kind: "completed", name }),
    disable: async (name) => ({ kind: "completed", name }),
    deleteSkill: async (agent, name) => ({ kind: "completed", name, agent }),
    remove: async (name) => ({ kind: "completed", name }),
    list: async () => [],
    snapshot: async (label) => ({ id: "snap-1", createdAt: "snap-1", ...(label ? { label } : {}) }),
    listSnapshots: async () => [],
    restoreSnapshot: async () => ({ restored: [] }),
    purge: async () => undefined,
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

  it("returns 3 for a malformed source option", async () => {
    const stderr = output();
    const exitCode = await runCli(["add", "pdf", "--from", "bad/id"], {
      service: fakeService(),
      stdout: output(),
      stderr
    });
    expect(exitCode).toBe(3);
    expect(stderr.text()).toContain("Invalid Agent id");
  });

  it("registers and lists Agents", async () => {
    const added: Array<[string, string]> = [];
    const agents = {
      list: async () => [
        { id: "codex", root: "/home/.codex/skills" },
        { id: "qoder", root: "/home/.qoder/skills" }
      ],
      add: async (id: string, root: string) => {
        added.push([id, root]);
        return [];
      },
      remove: async () => [],
      populate: async () => ({ installed: [], skipped: [] })
    };
    const addCode = await runCli(["agent", "add", "qoder", "--root", "/home/.qoder/skills"], {
      service: fakeService(),
      stdout: output(),
      stderr: output(),
      agents
    });
    expect(addCode).toBe(0);
    expect(added).toEqual([["qoder", "/home/.qoder/skills"]]);

    const listOut = output();
    await runCli(["agent", "list"], {
      service: fakeService(),
      stdout: listOut,
      stderr: output(),
      agents
    });
    expect(listOut.text()).toContain("qoder");
    expect(listOut.text()).toContain("/home/.qoder/skills");
  });

  it("deletes a Skill from an Agent", async () => {
    const calls: Array<[string, string]> = [];
    const stdout = output();
    const exitCode = await runCli(["delete", "junk", "--agent", "codex"], {
      service: fakeService({
        deleteSkill: async (agent, name) => {
          calls.push([agent, name]);
          return { kind: "completed", name, agent };
        }
      }),
      stdout,
      stderr: output()
    });
    expect(exitCode).toBe(0);
    expect(calls).toEqual([["codex", "junk"]]);
    expect(stdout.text()).toContain("deleted from codex");
  });

  it("unmanages every Skill with --all", async () => {
    const removed: string[] = [];
    const stdout = output();
    const exitCode = await runCli(["remove", "--all"], {
      service: fakeService({
        list: async () => [
          { name: "a", agents: { codex: "symlink", claude: "symlink" }, fingerprint: "f", updatedAt: "t" },
          { name: "b", agents: { codex: "symlink", claude: "symlink" }, fingerprint: "f", updatedAt: "t" }
        ],
        remove: async (name) => {
          removed.push(name);
          return { kind: "completed", name };
        }
      }),
      stdout,
      stderr: output()
    });
    expect(exitCode).toBe(0);
    expect(removed).toEqual(["a", "b"]);
    expect(stdout.text()).toContain("a is no longer managed by SkillPort.");
  });

  it("returns 3 when remove gets neither a Skill nor --all", async () => {
    const stderr = output();
    const exitCode = await runCli(["remove"], { service: fakeService(), stdout: output(), stderr });
    expect(exitCode).toBe(3);
    expect(stderr.text()).toContain("--all");
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

  it("starts the local management page", async () => {
    let started = false;
    const stdout = output();
    const exitCode = await runCli(["ui"], {
      service: fakeService(),
      stdout,
      stderr: output(),
      startUi: async () => {
        started = true;
        return "http://127.0.0.1:43111/#token=test";
      }
    });
    expect(exitCode).toBe(0);
    expect(started).toBe(true);
    expect(stdout.text()).toContain("管理页面已打开");
  });
});
