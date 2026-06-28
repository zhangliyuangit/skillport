import path from "node:path";
import type { GitHubSource } from "./domain.js";

export function parseSkillName(value: string): string {
  if (
    !value ||
    value === "." ||
    value === ".." ||
    path.posix.basename(value) !== value ||
    path.win32.basename(value) !== value
  ) {
    throw new Error(`Invalid Skill name: ${value}`);
  }
  return value;
}

export function parseGitHubSource(
  url: string,
  subpath?: string
): GitHubSource {
  const parsed = new URL(url);
  const parts = parsed.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parts.length !== 2
  ) {
    throw new Error("Expected https://github.com/<owner>/<repository>");
  }

  if (subpath) {
    const segments = subpath.split(/[\\/]/);
    if (path.isAbsolute(subpath) || segments.includes("..") || segments.includes("")) {
      throw new Error("GitHub Skill path must stay inside the repository");
    }
  }

  return {
    owner: parts[0]!,
    repo: parts[1]!,
    ...(subpath ? { path: subpath } : {})
  };
}
