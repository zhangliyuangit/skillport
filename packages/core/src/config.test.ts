import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigStore, parseAgentId } from "./config.js";

async function store() {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillport-config-"));
  return new ConfigStore(root, [
    { id: "codex", root: "/home/.codex/skills" },
    { id: "claude", root: "/home/.claude/skills" }
  ]);
}

describe("ConfigStore", () => {
  it("returns the defaults when no config file exists", async () => {
    const config = await store();
    expect(await config.list()).toEqual([
      { id: "codex", root: "/home/.codex/skills" },
      { id: "claude", root: "/home/.claude/skills" }
    ]);
  });

  it("registers and persists a custom Agent", async () => {
    const config = await store();
    await config.add("qoder", "/home/.qoder/skills");
    expect(await config.list()).toEqual([
      { id: "codex", root: "/home/.codex/skills" },
      { id: "claude", root: "/home/.claude/skills" },
      { id: "qoder", root: "/home/.qoder/skills" }
    ]);
  });

  it("rejects duplicates, relative roots, and removing the last Agent", async () => {
    const config = await store();
    await expect(config.add("codex", "/x")).rejects.toThrow(/already exists/);
    await expect(config.add("qoder", "relative/path")).rejects.toThrow(/absolute path/);
    await config.remove("codex");
    await expect(config.remove("claude")).rejects.toThrow(/last Agent/);
  });

  it("validates Agent id format", () => {
    expect(parseAgentId("qoder-cli")).toBe("qoder-cli");
    expect(() => parseAgentId("bad/id")).toThrow(/Invalid Agent id/);
    expect(() => parseAgentId("")).toThrow(/Invalid Agent id/);
  });
});
