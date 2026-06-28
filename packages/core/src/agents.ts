import { cp, lstat, mkdir, readlink, symlink } from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "./domain.js";
import { inspectSkillTree } from "./tree.js";

export type AgentEntry =
  | { kind: "missing"; path: string }
  | { kind: "local"; path: string; fingerprint: string }
  | { kind: "managed-link"; path: string; target: string }
  | { kind: "foreign-link"; path: string; target: string };

export class AgentAdapter {
  constructor(
    readonly id: AgentId,
    readonly root: string
  ) {}

  skillPath(name: string): string {
    return path.join(this.root, name);
  }

  async inspect(name: string, canonical: string): Promise<AgentEntry> {
    const entryPath = this.skillPath(name);
    const entryStat = await lstat(entryPath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    });

    if (!entryStat) return { kind: "missing", path: entryPath };

    if (entryStat.isSymbolicLink()) {
      const rawTarget = await readlink(entryPath);
      const target = path.resolve(path.dirname(entryPath), rawTarget);
      return path.resolve(canonical) === target
        ? { kind: "managed-link", path: entryPath, target }
        : { kind: "foreign-link", path: entryPath, target };
    }

    if (!entryStat.isDirectory()) {
      throw new Error(`Agent Skill path is not a directory: ${entryPath}`);
    }

    const { fingerprint } = await inspectSkillTree(entryPath);
    return { kind: "local", path: entryPath, fingerprint };
  }

  async installLink(name: string, canonical: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await symlink(canonical, this.skillPath(name), "dir");
  }

  async installCopy(name: string, canonical: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await cp(canonical, this.skillPath(name), {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false
    });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
