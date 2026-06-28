import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { describe, expect, it } from "vitest";
import { GitHubInstaller } from "./github.js";
import { AgentAdapter } from "./agents.js";
import { SkillPortService } from "./service.js";
import { StateStore } from "./state-store.js";

async function archive(
  populate: (repository: string) => Promise<void>
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillport-archive-"));
  const repository = path.join(root, "repository-main");
  await mkdir(repository);
  await populate(repository);
  const filename = path.join(root, "repository.tgz");
  await tar.c({ cwd: root, file: filename, gzip: true }, ["repository-main"]);
  return filename;
}

function installer(filename: string): GitHubInstaller {
  return new GitHubInstaller({
    fetchArchive: async (_url, destination) => copyFile(filename, destination)
  });
}

describe("GitHubInstaller", () => {
  it("downloads a repository-root Skill", async () => {
    const filename = await archive(async (repository) => {
      await writeFile(path.join(repository, "SKILL.md"), "# PDF");
    });
    const staged = await installer(filename).download({ owner: "acme", repo: "pdf" });
    expect(await readFile(path.join(staged.path, "SKILL.md"), "utf8")).toBe("# PDF");
    const selectedPath = staged.path;
    await staged.cleanup();
    await expect(stat(selectedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("selects a Skill from a repository subdirectory", async () => {
    const filename = await archive(async (repository) => {
      await mkdir(path.join(repository, "skills", "pdf"), { recursive: true });
      await writeFile(path.join(repository, "skills", "pdf", "SKILL.md"), "# PDF");
    });
    const staged = await installer(filename).download({
      owner: "acme",
      repo: "skills",
      path: "skills/pdf"
    });
    expect(await readFile(path.join(staged.path, "SKILL.md"), "utf8")).toBe("# PDF");
    await staged.cleanup();
  });

  it("rejects a repository without SKILL.md", async () => {
    const filename = await archive(async (repository) => {
      await writeFile(path.join(repository, "README.md"), "not a Skill");
    });
    await expect(
      installer(filename).download({ owner: "acme", repo: "empty" })
    ).rejects.toThrow("regular SKILL.md");
  });

  it("rejects symbolic links in downloaded archives", async () => {
    const filename = await archive(async (repository) => {
      await writeFile(path.join(repository, "SKILL.md"), "# Unsafe");
      await symlink("/tmp", path.join(repository, "escape"));
    });
    await expect(
      installer(filename).download({ owner: "acme", repo: "unsafe" })
    ).rejects.toThrow("unsupported archive entry");
  });

  it("does not mask network failures", async () => {
    const target = new GitHubInstaller({
      fetchArchive: async () => {
        throw new Error("network unavailable");
      }
    });
    await expect(target.download({ owner: "acme", repo: "pdf" })).rejects.toThrow(
      "network unavailable"
    );
  });
});

describe("SkillPortService.install", () => {
  it("records provenance and links both Agents", async () => {
    const filename = await archive(async (repository) => {
      await mkdir(path.join(repository, "skills", "pdf"), { recursive: true });
      await writeFile(path.join(repository, "skills", "pdf", "SKILL.md"), "# PDF");
    });
    const home = await mkdtemp(path.join(os.tmpdir(), "skillport-install-"));
    const root = path.join(home, ".skillport");
    const store = new StateStore(root);
    const service = new SkillPortService({
      root,
      stateStore: store,
      githubInstaller: installer(filename),
      agents: [
        new AgentAdapter("codex", path.join(home, ".codex", "skills")),
        new AgentAdapter("claude", path.join(home, ".claude", "skills"))
      ]
    });

    await expect(
      service.install("https://github.com/acme/skills", "skills/pdf")
    ).resolves.toMatchObject({ kind: "completed", name: "pdf" });

    expect((await store.load()).skills.pdf?.source).toEqual({
      owner: "acme",
      repo: "skills",
      path: "skills/pdf"
    });
  });

  it("requires a source decision when GitHub conflicts with a local Skill", async () => {
    const filename = await archive(async (repository) => {
      await writeFile(path.join(repository, "SKILL.md"), "github");
    });
    const home = await mkdtemp(path.join(os.tmpdir(), "skillport-collision-"));
    const root = path.join(home, ".skillport");
    const codex = path.join(home, ".codex", "skills");
    await mkdir(path.join(codex, "pdf"), { recursive: true });
    await writeFile(path.join(codex, "pdf", "SKILL.md"), "local");
    const service = new SkillPortService({
      root,
      stateStore: new StateStore(root),
      githubInstaller: installer(filename),
      agents: [
        new AgentAdapter("codex", codex),
        new AgentAdapter("claude", path.join(home, ".claude", "skills"))
      ]
    });

    await expect(service.install("https://github.com/acme/pdf")).resolves.toEqual({
      kind: "decision-required",
      name: "pdf",
      choices: ["github", "codex"]
    });
  });
});
