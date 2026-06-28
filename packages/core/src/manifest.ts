import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Reads the `description:` field from a Skill's SKILL.md YAML frontmatter.
 * Returns undefined when the file or field is missing.
 */
export async function readSkillDescription(root: string): Promise<string | undefined> {
  let contents: string;
  try {
    contents = await readFile(path.join(root, "SKILL.md"), "utf8");
  } catch {
    return undefined;
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents);
  if (!frontmatter) return undefined;
  const line = /^description:\s*(.+?)\s*$/m.exec(frontmatter[1]!);
  if (!line) return undefined;
  let value = line[1]!.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value || undefined;
}

/**
 * Reads a Skill's SKILL.md text for preview, truncated to maxBytes.
 * Rejects binary content.
 */
export async function readSkillContent(
  root: string,
  maxBytes = 64 * 1024
): Promise<{ text: string; truncated: boolean }> {
  const contents = await readFile(path.join(root, "SKILL.md"));
  if (contents.includes(0)) throw new Error("SKILL.md appears to be binary");
  const truncated = contents.byteLength > maxBytes;
  return {
    text: contents.subarray(0, maxBytes).toString("utf8"),
    truncated
  };
}
