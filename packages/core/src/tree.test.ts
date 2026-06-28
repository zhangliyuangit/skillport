import {
  mkdir,
  mkdtemp,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectSkillTree } from "./tree.js";

async function temporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("inspectSkillTree", () => {
  it("produces the same fingerprint regardless of creation order", async () => {
    const root = await temporaryDirectory("skillport-tree-");
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    await mkdir(path.join(a, "references"), { recursive: true });
    await mkdir(path.join(b, "references"), { recursive: true });

    await writeFile(path.join(a, "SKILL.md"), "# PDF\n");
    await writeFile(path.join(a, "references", "x.txt"), "x");
    await writeFile(path.join(b, "references", "x.txt"), "x");
    await writeFile(path.join(b, "SKILL.md"), "# PDF\n");

    const first = await inspectSkillTree(a);
    const second = await inspectSkillTree(b);

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.files).toEqual(["references/x.txt", "SKILL.md"]);
  });

  it("changes the fingerprint when file contents change", async () => {
    const root = await temporaryDirectory("skillport-change-");
    await writeFile(path.join(root, "SKILL.md"), "first");
    const before = await inspectSkillTree(root);
    await writeFile(path.join(root, "SKILL.md"), "second");
    const after = await inspectSkillTree(root);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it("ignores macOS metadata", async () => {
    const root = await temporaryDirectory("skillport-metadata-");
    await writeFile(path.join(root, "SKILL.md"), "# PDF");
    const before = await inspectSkillTree(root);
    await writeFile(path.join(root, ".DS_Store"), "metadata");
    expect((await inspectSkillTree(root)).fingerprint).toBe(before.fingerprint);
  });

  it("requires a regular SKILL.md", async () => {
    const root = await temporaryDirectory("skillport-missing-");
    await expect(inspectSkillTree(root)).rejects.toThrow(
      "regular SKILL.md"
    );
  });

  it("rejects symbolic links inside a Skill", async () => {
    const root = await temporaryDirectory("skillport-link-");
    await writeFile(path.join(root, "SKILL.md"), "# Unsafe");
    await symlink("/tmp", path.join(root, "escape"));
    await expect(inspectSkillTree(root)).rejects.toThrow("symbolic link");
  });
});
