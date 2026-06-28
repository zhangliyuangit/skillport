import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface TreeInspection {
  fingerprint: string;
  files: string[];
}

export async function inspectSkillTree(root: string): Promise<TreeInspection> {
  const skillFile = path.join(root, "SKILL.md");
  const skillStat = await stat(skillFile).catch(() => undefined);
  if (!skillStat?.isFile()) {
    throw new Error("Skill must contain a regular SKILL.md");
  }

  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;

      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");

      if (entry.isSymbolicLink()) {
        throw new Error(`Skill contains symbolic link: ${relative}`);
      }
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      } else {
        throw new Error(`Skill contains unsupported file: ${relative}`);
      }
    }
  }

  await walk(root);
  files.sort((left, right) => left.localeCompare(right));

  const hash = createHash("sha256");
  for (const file of files) {
    hash
      .update(file)
      .update("\0")
      .update(await readFile(path.join(root, file)))
      .update("\0");
  }

  return { files, fingerprint: hash.digest("hex") };
}
