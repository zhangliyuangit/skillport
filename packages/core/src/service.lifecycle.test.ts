import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentAdapter } from "./agents.js";
import { SkillPortService } from "./service.js";
import { StateStore } from "./state-store.js";

async function fixture(copyClaude = false) {
  const home = await mkdtemp(path.join(os.tmpdir(), "skillport-life-"));
  const root = path.join(home, ".skillport");
  const codexRoot = path.join(home, ".codex", "skills");
  const claudeRoot = path.join(home, ".claude", "skills");
  class CopyAdapter extends AgentAdapter {
    override async installLink(): Promise<void> {
      throw Object.assign(new Error("no links"), { code: "EPERM" });
    }
  }
  const agents = [
    new AgentAdapter("codex", codexRoot),
    copyClaude
      ? new CopyAdapter("claude", claudeRoot)
      : new AgentAdapter("claude", claudeRoot)
  ];
  return {
    home,
    root,
    codexRoot,
    claudeRoot,
    store: new StateStore(root),
    service: new SkillPortService({ root, agents, stateStore: new StateStore(root) })
  };
}

async function skill(root: string, name: string, body: string): Promise<void> {
  await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, name, "SKILL.md"), body);
}

describe("scan", () => {
  it("classifies one-source, identical, and conflicting Skills", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "codex-only", "one");
    await skill(f.codexRoot, "same", "same");
    await skill(f.claudeRoot, "same", "same");
    await skill(f.codexRoot, "conflict", "codex");
    await skill(f.claudeRoot, "conflict", "claude");

    expect(await f.service.scan()).toEqual([
      { name: "codex-only", classification: "single-source", agents: ["codex"] },
      { name: "conflict", classification: "conflict", agents: ["codex", "claude"] },
      { name: "same", classification: "identical", agents: ["codex", "claude"] }
    ]);
  });

  it("skips unrelated directories without a SKILL.md", async () => {
    const f = await fixture();
    await mkdir(path.join(f.codexRoot, "codex-primary-runtime"), {
      recursive: true
    });
    await skill(f.codexRoot, "real-skill", "# Real Skill");

    expect(await f.service.scan()).toEqual([
      {
        name: "real-skill",
        classification: "single-source",
        agents: ["codex"]
      }
    ]);
  });

  it("flags a Skill with a symbolic link without hiding the others", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "good", "ok");
    await skill(f.codexRoot, "pyskill", "py");
    await mkdir(path.join(f.codexRoot, "pyskill", "vendor"), { recursive: true });
    await symlink("/usr/bin/true", path.join(f.codexRoot, "pyskill", "vendor", "link"));

    expect(await f.service.scan()).toEqual([
      { name: "good", classification: "single-source", agents: ["codex"] },
      { name: "pyskill", classification: "error", agents: ["codex"] }
    ]);
  });
});

describe("managed lifecycle", () => {
  it("reports healthy links as Synced", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "pdf", "# PDF");
    await f.service.add("pdf");
    expect(await f.service.status("pdf")).toMatchObject([
      { name: "pdf", overall: "Synced" }
    ]);
  });

  it("detects copy drift and synchronizes from an explicit source", async () => {
    const f = await fixture(true);
    await skill(f.codexRoot, "pdf", "before");
    await f.service.add("pdf");
    await writeFile(path.join(f.claudeRoot, "pdf", "SKILL.md"), "after");

    expect(await f.service.status("pdf")).toMatchObject([
      { name: "pdf", overall: "Local changes" }
    ]);
    await f.service.sync("pdf", "claude");

    expect(
      await readFile(path.join(f.root, "skills", "pdf", "SKILL.md"), "utf8")
    ).toBe("after");
    expect(await f.service.status("pdf")).toMatchObject([
      { name: "pdf", overall: "Synced" }
    ]);
  });

  it("shows a bounded text difference between Agent copies", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "review", "line one\nCodex line\n");
    await skill(f.claudeRoot, "review", "line one\nClaude line\n");
    const result = await f.service.diff("review");
    expect(result.text).toContain("-Codex line");
    expect(result.text).toContain("+Claude line");
  });

  it("restores ordinary Agent directories before removing management", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "pdf", "# PDF");
    await f.service.add("pdf");

    await f.service.remove("pdf");

    for (const root of [f.codexRoot, f.claudeRoot]) {
      expect((await lstat(path.join(root, "pdf"))).isDirectory()).toBe(true);
      expect(await readFile(path.join(root, "pdf", "SKILL.md"), "utf8")).toBe("# PDF");
    }
    await expect(stat(path.join(f.root, "skills", "pdf"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect((await f.store.load()).skills.pdf).toBeUndefined();
  });
});
