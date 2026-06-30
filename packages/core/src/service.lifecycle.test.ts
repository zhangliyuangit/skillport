import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentAdapter } from "./agents.js";
import type { GitHubInstaller } from "./github.js";
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

describe("enable/disable per Agent", () => {
  it("turns one Agent off and back on while keeping the other intact", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "pdf", "# PDF");
    await f.service.add("pdf");

    await f.service.disable("pdf", "codex");
    expect(await f.service.status("pdf")).toMatchObject([
      { name: "pdf", overall: "Synced", agents: { codex: "disabled", claude: "linked" } }
    ]);
    await expect(lstat(path.join(f.codexRoot, "pdf"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await lstat(path.join(f.claudeRoot, "pdf"))).isSymbolicLink()).toBe(true);
    expect((await stat(path.join(f.root, "skills", "pdf", "SKILL.md"))).isFile()).toBe(true);

    await f.service.enable("pdf", "codex");
    expect(await f.service.status("pdf")).toMatchObject([
      { name: "pdf", overall: "Synced", agents: { codex: "linked", claude: "linked" } }
    ]);
    expect((await lstat(path.join(f.codexRoot, "pdf"))).isSymbolicLink()).toBe(true);
  });

  it("refuses to disable the last active Agent", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "pdf", "# PDF");
    await f.service.add("pdf");
    await f.service.disable("pdf", "codex");
    await expect(f.service.disable("pdf", "claude")).rejects.toThrow(/last active Agent/);
  });
});

describe("custom Agents", () => {
  it("manages a Skill across three configured Agents", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "skillport-multi-"));
    const root = path.join(home, ".skillport");
    const roots = {
      codex: path.join(home, ".codex", "skills"),
      claude: path.join(home, ".claude", "skills"),
      qoder: path.join(home, ".qoder", "skills")
    };
    const service = new SkillPortService({
      root,
      stateStore: new StateStore(root),
      agents: [
        new AgentAdapter("codex", roots.codex),
        new AgentAdapter("claude", roots.claude),
        new AgentAdapter("qoder", roots.qoder)
      ]
    });
    await skill(roots.codex, "pdf", "# PDF");
    await service.add("pdf");

    for (const dir of Object.values(roots)) {
      expect((await lstat(path.join(dir, "pdf"))).isSymbolicLink()).toBe(true);
    }
    expect(await service.status("pdf")).toMatchObject([
      {
        name: "pdf",
        overall: "Synced",
        agents: { codex: "linked", claude: "linked", qoder: "linked" }
      }
    ]);

    await service.disable("pdf", "qoder");
    expect(await service.status("pdf")).toMatchObject([
      { name: "pdf", overall: "Synced", agents: { qoder: "disabled" } }
    ]);
    await expect(lstat(path.join(roots.qoder, "pdf"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("populates a newly added Agent with existing managed Skills", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "skillport-pop-"));
    const root = path.join(home, ".skillport");
    const codexRoot = path.join(home, ".codex", "skills");
    const claudeRoot = path.join(home, ".claude", "skills");
    const qoderRoot = path.join(home, ".qoder", "skills");
    const service = new SkillPortService({
      root,
      stateStore: new StateStore(root),
      agents: [
        new AgentAdapter("codex", codexRoot),
        new AgentAdapter("claude", claudeRoot)
      ]
    });
    await skill(codexRoot, "pdf", "# PDF");
    await service.add("pdf");

    // Register qoder after the Skill is already managed.
    service.setAgents([
      new AgentAdapter("codex", codexRoot),
      new AgentAdapter("claude", claudeRoot),
      new AgentAdapter("qoder", qoderRoot)
    ]);
    expect(await service.status("pdf")).toMatchObject([
      { name: "pdf", overall: "Missing", agents: { qoder: "missing" } }
    ]);

    const result = await service.populate("qoder");
    expect(result.installed).toEqual(["pdf"]);
    expect((await lstat(path.join(qoderRoot, "pdf"))).isSymbolicLink()).toBe(true);
    expect(await service.status("pdf")).toMatchObject([
      { name: "pdf", overall: "Synced", agents: { qoder: "linked" } }
    ]);
  });
});

describe("create", () => {
  it("scaffolds a new managed Skill from a template", async () => {
    const f = await fixture();
    const result = await f.service.create("brand-new", "does a thing");
    expect(result).toMatchObject({ kind: "completed", name: "brand-new" });

    const md = await readFile(path.join(f.root, "skills", "brand-new", "SKILL.md"), "utf8");
    expect(md).toContain("name: brand-new");
    expect(md).toContain("does a thing");
    expect((await lstat(path.join(f.codexRoot, "brand-new"))).isSymbolicLink()).toBe(true);
    expect((await lstat(path.join(f.claudeRoot, "brand-new"))).isSymbolicLink()).toBe(true);

    await expect(f.service.create("brand-new")).rejects.toThrow(/already managed/);
  });
});

describe("doctor", () => {
  it("reports a missing link and repairs it", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "pdf", "# PDF");
    await f.service.add("pdf");
    await rm(path.join(f.codexRoot, "pdf"), { recursive: true, force: true });

    const issues = await f.service.doctor();
    expect(issues.some((issue) => issue.name === "pdf" && issue.agent === "codex" && issue.kind === "missing")).toBe(true);

    const result = await f.service.repair();
    expect(result.fixed).toBeGreaterThanOrEqual(1);
    expect(await f.service.doctor()).toEqual([]);
    expect((await lstat(path.join(f.codexRoot, "pdf"))).isSymbolicLink()).toBe(true);
  });
});

describe("update", () => {
  it("re-pulls a changed GitHub Skill and reports up-to-date otherwise", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "skillport-update-"));
    const root = path.join(home, ".skillport");
    const codexRoot = path.join(home, ".codex", "skills");
    const claudeRoot = path.join(home, ".claude", "skills");
    const download = path.join(home, "download");
    await mkdir(download, { recursive: true });
    await writeFile(path.join(download, "SKILL.md"), "v1");

    const installer = {
      download: async () => ({ path: download, skipped: [], cleanup: async () => undefined })
    } as unknown as GitHubInstaller;
    const service = new SkillPortService({
      root,
      stateStore: new StateStore(root),
      agents: [new AgentAdapter("codex", codexRoot), new AgentAdapter("claude", claudeRoot)],
      githubInstaller: installer
    });

    await service.install("https://github.com/acme/pdf");
    await writeFile(path.join(download, "SKILL.md"), "v2");

    expect(await service.update("pdf")).toEqual({ name: "pdf", updated: true });
    expect(await readFile(path.join(root, "skills", "pdf", "SKILL.md"), "utf8")).toBe("v2");
    expect(await readFile(path.join(codexRoot, "pdf", "SKILL.md"), "utf8")).toBe("v2");
    expect(await service.update("pdf")).toEqual({ name: "pdf", updated: false });
  });
});

describe("snapshots", () => {
  it("restores central content and keeps Agent links working", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "pdf", "v1");
    await f.service.add("pdf");
    const snap = await f.service.snapshot("manual");

    await writeFile(path.join(f.root, "skills", "pdf", "SKILL.md"), "v2");
    expect(await readFile(path.join(f.codexRoot, "pdf", "SKILL.md"), "utf8")).toBe("v2");

    await f.service.restoreSnapshot(snap.id);
    expect(await readFile(path.join(f.root, "skills", "pdf", "SKILL.md"), "utf8")).toBe("v1");
    expect(await readFile(path.join(f.codexRoot, "pdf", "SKILL.md"), "utf8")).toBe("v1");
    expect((await lstat(path.join(f.codexRoot, "pdf"))).isSymbolicLink()).toBe(true);
  });

  it("auto-snapshots before a sync", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "pdf", "v1");
    await f.service.add("pdf");
    await f.service.sync("pdf", "central");
    const snapshots = await f.service.listSnapshots();
    expect(snapshots.some((snapshot) => snapshot.label === "before-sync-pdf")).toBe(true);
  });
});

describe("preview", () => {
  it("returns SKILL.md text from the central copy and a specific Agent", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "pdf", "# PDF\nhello");
    await f.service.add("pdf");
    expect((await f.service.preview("pdf")).text).toContain("hello");
    expect((await f.service.preview("pdf", "codex")).text).toContain("hello");
  });
});

describe("delete unmanaged Skill", () => {
  it("moves an unmanaged Skill to the trash", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "junk", "junk body");
    await f.service.deleteSkill("codex", "junk");
    await expect(lstat(path.join(f.codexRoot, "junk"))).rejects.toMatchObject({ code: "ENOENT" });
    const trashed = await readdir(path.join(f.root, "trash"));
    expect(trashed.some((entry) => entry.startsWith("codex__junk__"))).toBe(true);
  });

  it("refuses to delete a managed Skill", async () => {
    const f = await fixture();
    await skill(f.codexRoot, "pdf", "# PDF");
    await f.service.add("pdf");
    await expect(f.service.deleteSkill("codex", "pdf")).rejects.toThrow(/managed/);
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
