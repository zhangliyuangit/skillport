import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentAdapter } from "./agents.js";
import { SkillPortService } from "./service.js";
import { StateStore } from "./state-store.js";

async function createFixture(adapters?: (home: string) => AgentAdapter[]) {
  const home = await mkdtemp(path.join(os.tmpdir(), "skillport-add-"));
  const skillportRoot = path.join(home, ".skillport");
  const codexRoot = path.join(home, ".codex", "skills");
  const claudeRoot = path.join(home, ".claude", "skills");
  const agents = adapters?.(home) ?? [
    new AgentAdapter("codex", codexRoot),
    new AgentAdapter("claude", claudeRoot)
  ];
  return {
    home,
    skillportRoot,
    codexRoot,
    claudeRoot,
    service: new SkillPortService({
      root: skillportRoot,
      agents,
      stateStore: new StateStore(skillportRoot),
      now: () => new Date("2026-06-28T00:00:00.000Z")
    })
  };
}

async function createSkill(root: string, name: string, body: string): Promise<void> {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), body);
}

async function snapshot(root: string): Promise<string[]> {
  const entries: string[] = [];
  async function walk(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true }).catch(() => []);
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(root, absolute);
      if (child.isSymbolicLink()) entries.push(`${relative}->${await readlink(absolute)}`);
      else if (child.isDirectory()) {
        entries.push(`${relative}/`);
        await walk(absolute);
      } else entries.push(`${relative}:${await readFile(absolute, "utf8")}`);
    }
  }
  await walk(root);
  return entries;
}

describe("SkillPortService.add", () => {
  it("moves a Codex-only Skill to canonical storage and links both agents", async () => {
    const fixture = await createFixture();
    await createSkill(fixture.codexRoot, "pdf", "# PDF");

    const result = await fixture.service.add("pdf");

    expect(result).toMatchObject({ kind: "completed", name: "pdf" });
    const canonical = path.join(fixture.skillportRoot, "skills", "pdf");
    expect(await readFile(path.join(canonical, "SKILL.md"), "utf8")).toBe("# PDF");
    for (const root of [fixture.codexRoot, fixture.claudeRoot]) {
      const installed = path.join(root, "pdf");
      expect((await lstat(installed)).isSymbolicLink()).toBe(true);
      expect(path.resolve(root, await readlink(installed))).toBe(canonical);
    }
    expect((await new StateStore(fixture.skillportRoot).load()).skills.pdf).toMatchObject({
      name: "pdf",
      agents: { codex: "symlink", claude: "symlink" }
    });
  });

  it("consolidates identical Agent copies without a source choice", async () => {
    const fixture = await createFixture();
    await createSkill(fixture.codexRoot, "review", "same");
    await createSkill(fixture.claudeRoot, "review", "same");
    await expect(fixture.service.add("review")).resolves.toMatchObject({
      kind: "completed"
    });
  });

  it("returns a decision and performs no writes for differing copies", async () => {
    const fixture = await createFixture();
    await createSkill(fixture.codexRoot, "review", "codex");
    await createSkill(fixture.claudeRoot, "review", "claude");
    const before = await snapshot(fixture.home);

    const result = await fixture.service.add("review");

    expect(result).toEqual({
      kind: "decision-required",
      name: "review",
      choices: ["codex", "claude"]
    });
    expect(await snapshot(fixture.home)).toEqual(before);
  });

  it("uses the explicitly selected conflicting source", async () => {
    const fixture = await createFixture();
    await createSkill(fixture.codexRoot, "review", "codex");
    await createSkill(fixture.claudeRoot, "review", "claude");

    await fixture.service.add("review", "claude");

    expect(
      await readFile(
        path.join(fixture.skillportRoot, "skills", "review", "SKILL.md"),
        "utf8"
      )
    ).toBe("claude");
  });

  it("falls back to copy mode for an Agent that cannot create links", async () => {
    class NoLinksAdapter extends AgentAdapter {
      override async installLink(): Promise<void> {
        throw Object.assign(new Error("links unavailable"), { code: "EPERM" });
      }
    }
    const fixture = await createFixture((home) => [
      new AgentAdapter("codex", path.join(home, ".codex", "skills")),
      new NoLinksAdapter("claude", path.join(home, ".claude", "skills"))
    ]);
    await createSkill(fixture.codexRoot, "pdf", "# PDF");

    await fixture.service.add("pdf");

    expect((await lstat(path.join(fixture.claudeRoot, "pdf"))).isDirectory()).toBe(true);
    expect((await new StateStore(fixture.skillportRoot).load()).skills.pdf?.agents.claude).toBe(
      "copy"
    );
  });

  it("rolls back original directories when installation fails", async () => {
    class BrokenAdapter extends AgentAdapter {
      override async installLink(): Promise<void> {
        throw new Error("link failed");
      }
      override async installCopy(name: string): Promise<void> {
        const partial = this.skillPath(name);
        await mkdir(partial, { recursive: true });
        await writeFile(path.join(partial, "partial"), "incomplete");
        throw new Error("copy failed");
      }
    }
    const fixture = await createFixture((home) => [
      new AgentAdapter("codex", path.join(home, ".codex", "skills")),
      new BrokenAdapter("claude", path.join(home, ".claude", "skills"))
    ]);
    await createSkill(fixture.codexRoot, "pdf", "original");

    await expect(fixture.service.add("pdf")).rejects.toThrow("copy failed");

    expect(await readFile(path.join(fixture.codexRoot, "pdf", "SKILL.md"), "utf8")).toBe(
      "original"
    );
    await expect(stat(path.join(fixture.skillportRoot, "skills", "pdf"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(stat(path.join(fixture.claudeRoot, "pdf"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect((await new StateStore(fixture.skillportRoot).load()).skills).toEqual({});
  });
});
