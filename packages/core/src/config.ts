import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export interface AgentConfig {
  id: string;
  root: string;
}

const agentConfigSchema = z
  .object({
    id: z.string().min(1),
    root: z.string().min(1)
  })
  .strict();

const configSchema = z
  .object({
    agents: z.array(agentConfigSchema)
  })
  .strict();

const AGENT_ID = /^[a-z0-9][a-z0-9-]*$/i;

export function parseAgentId(value: string): string {
  if (!AGENT_ID.test(value)) {
    throw new Error(`Invalid Agent id: ${value}`);
  }
  return value;
}

/**
 * Reads and writes the list of Agent endpoints from `<root>/config.json`.
 * When no config file exists the caller-provided defaults are returned, so
 * codex and claude keep working without any configuration.
 */
export class ConfigStore {
  constructor(
    readonly root: string,
    private readonly defaults: AgentConfig[]
  ) {}

  async list(): Promise<AgentConfig[]> {
    const filename = path.join(this.root, "config.json");
    let contents: string;
    try {
      contents = await readFile(filename, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [...this.defaults];
      throw error;
    }
    try {
      return configSchema.parse(JSON.parse(contents)).agents;
    } catch (error) {
      throw new Error("Invalid SkillPort config", { cause: error });
    }
  }

  async add(id: string, root: string): Promise<AgentConfig[]> {
    const agentId = parseAgentId(id);
    if (!path.isAbsolute(root)) {
      throw new Error(`Agent root must be an absolute path: ${root}`);
    }
    const agents = await this.list();
    if (agents.some((agent) => agent.id === agentId)) {
      throw new Error(`Agent already exists: ${agentId}`);
    }
    const next = [...agents, { id: agentId, root }];
    await this.save(next);
    return next;
  }

  async remove(id: string): Promise<AgentConfig[]> {
    const agents = await this.list();
    if (!agents.some((agent) => agent.id === id)) {
      throw new Error(`Agent is not configured: ${id}`);
    }
    const next = agents.filter((agent) => agent.id !== id);
    if (next.length === 0) {
      throw new Error("Cannot remove the last Agent");
    }
    await this.save(next);
    return next;
  }

  private async save(agents: AgentConfig[]): Promise<void> {
    const validated = configSchema.parse({ agents });
    await mkdir(this.root, { recursive: true });
    const destination = path.join(this.root, "config.json");
    const temporary = path.join(
      this.root,
      `config.json.tmp-${process.pid}-${randomUUID()}`
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
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
