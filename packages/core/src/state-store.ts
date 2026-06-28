import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ManagedSkill } from "./domain.js";

export interface SkillPortState {
  schemaVersion: 1;
  skills: Record<string, ManagedSkill>;
}

const githubSourceSchema = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    path: z.string().min(1).optional()
  })
  .strict();

const managedSkillSchema = z
  .object({
    name: z.string().min(1),
    agents: z
      .object({
        codex: z.enum(["symlink", "copy"]),
        claude: z.enum(["symlink", "copy"])
      })
      .strict(),
    fingerprint: z.string().min(1),
    source: githubSourceSchema.optional(),
    updatedAt: z.string().datetime()
  })
  .strict();

const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    skills: z.record(z.string(), managedSkillSchema)
  })
  .strict();

export class StateStore {
  constructor(readonly root: string) {}

  async load(): Promise<SkillPortState> {
    const filename = path.join(this.root, "state.json");
    let contents: string;
    try {
      contents = await readFile(filename, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { schemaVersion: 1, skills: {} };
      }
      throw error;
    }

    try {
      return stateSchema.parse(JSON.parse(contents));
    } catch (error) {
      throw new Error("Invalid SkillPort state", { cause: error });
    }
  }

  async save(state: SkillPortState): Promise<void> {
    const validated = stateSchema.parse(state);
    await mkdir(this.root, { recursive: true });

    const destination = path.join(this.root, "state.json");
    const temporary = path.join(
      this.root,
      `state.json.tmp-${process.pid}-${randomUUID()}`
    );
    const handle = await open(temporary, "wx", 0o600);

    try {
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true });
    const lock = path.join(this.root, ".lock");

    try {
      await mkdir(lock);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new Error("another operation is running");
      }
      throw error;
    }

    try {
      return await operation();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
