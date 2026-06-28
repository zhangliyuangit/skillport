import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSkillDescription } from "./manifest.js";

async function skillDir(body: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skillport-manifest-"));
  await mkdir(path.join(dir, "s"), { recursive: true });
  await writeFile(path.join(dir, "s", "SKILL.md"), body);
  return path.join(dir, "s");
}

describe("readSkillDescription", () => {
  it("reads the description from frontmatter", async () => {
    const dir = await skillDir("---\nname: pdf\ndescription: Handle PDF files\n---\nbody\n");
    expect(await readSkillDescription(dir)).toBe("Handle PDF files");
  });

  it("strips surrounding quotes", async () => {
    const dir = await skillDir('---\nname: pdf\ndescription: "Quoted desc"\n---\n');
    expect(await readSkillDescription(dir)).toBe("Quoted desc");
  });

  it("returns undefined when missing", async () => {
    const dir = await skillDir("---\nname: pdf\n---\nbody\n");
    expect(await readSkillDescription(dir)).toBeUndefined();
  });
});
