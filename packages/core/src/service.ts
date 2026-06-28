import { randomUUID } from "node:crypto";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { AgentAdapter, AgentEntry } from "./agents.js";
import type { AgentId, ManagedSkill, SyncMode } from "./domain.js";
import { TransactionJournal } from "./executor.js";
import { parseSkillName } from "./paths.js";
import type { AddCandidate, AddResult } from "./planner.js";
import type { StateStore } from "./state-store.js";

export interface SkillPortServiceOptions {
  root: string;
  agents: AgentAdapter[];
  stateStore: StateStore;
  now?: () => Date;
}

interface Inspection {
  candidates: AddCandidate[];
  entries: Map<AgentId, AgentEntry>;
}

export class SkillPortService {
  private readonly now: () => Date;

  constructor(private readonly options: SkillPortServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async add(nameValue: string, from?: AgentId): Promise<AddResult> {
    const name = parseSkillName(nameValue);
    const canonical = this.canonicalPath(name);
    const initial = await this.inspectLocalCopies(name, canonical);
    const choice = chooseCandidate(name, initial.candidates, from);

    if (choice.kind === "decision-required") return choice;

    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      if (state.skills[name]) throw new Error(`Skill is already managed: ${name}`);

      const current = await this.inspectLocalCopies(name, canonical);
      const selected = current.candidates.find(
        (candidate) => candidate.agent === choice.candidate.agent
      );
      if (!selected || selected.fingerprint !== choice.candidate.fingerprint) {
        throw new Error(`Skill changed while preparing add: ${name}`);
      }

      const operationRoot = path.join(this.options.root, ".operations", randomUUID());
      const staged = path.join(operationRoot, "staged", name);
      const journal = new TransactionJournal(operationRoot);
      await mkdir(path.dirname(staged), { recursive: true });
      await cp(selected.path, staged, { recursive: true, dereference: false });

      try {
        for (const agent of this.options.agents) {
          const entry = current.entries.get(agent.id)!;
          if (entry.kind === "local") {
            await journal.backup(entry.path, agent.id);
          }
        }

        await mkdir(path.dirname(canonical), { recursive: true });
        await rename(staged, canonical);

        const modes = {} as Record<AgentId, SyncMode>;
        for (const agent of this.options.agents) {
          journal.markInstalled(agent.skillPath(name));
          try {
            await agent.installLink(name, canonical);
            modes[agent.id] = "symlink";
          } catch {
            await agent.installCopy(name, canonical);
            modes[agent.id] = "copy";
          }
        }

        const managed: ManagedSkill = {
          name,
          agents: modes,
          fingerprint: selected.fingerprint,
          updatedAt: this.now().toISOString()
        };
        await this.options.stateStore.save({
          schemaVersion: 1,
          skills: { ...state.skills, [name]: managed }
        });
        await journal.commit();
        return { kind: "completed", name, agents: modes };
      } catch (error) {
        await journal.rollback(canonical);
        throw error;
      } finally {
        await rm(operationRoot, { recursive: true, force: true });
      }
    });
  }

  private canonicalPath(name: string): string {
    return path.join(this.options.root, "skills", name);
  }

  private async inspectLocalCopies(
    name: string,
    canonical: string
  ): Promise<Inspection> {
    const candidates: AddCandidate[] = [];
    const entries = new Map<AgentId, AgentEntry>();
    for (const agent of this.options.agents) {
      const entry = await agent.inspect(name, canonical);
      entries.set(agent.id, entry);
      if (entry.kind === "foreign-link") {
        throw new Error(`Refusing to replace unrelated symbolic link: ${entry.path}`);
      }
      if (entry.kind === "managed-link") {
        throw new Error(`Skill appears managed but is missing state: ${name}`);
      }
      if (entry.kind === "local") {
        candidates.push({ agent: agent.id, path: entry.path, fingerprint: entry.fingerprint });
      }
    }
    return { candidates, entries };
  }
}

function chooseCandidate(
  name: string,
  candidates: AddCandidate[],
  from?: AgentId
):
  | { kind: "selected"; candidate: AddCandidate }
  | {
      kind: "decision-required";
      name: string;
      choices: AgentId[];
    } {
  if (candidates.length === 0) throw new Error(`Skill not found: ${name}`);

  if (from) {
    const selected = candidates.find((candidate) => candidate.agent === from);
    if (!selected) throw new Error(`Selected source does not contain Skill: ${from}`);
    return { kind: "selected", candidate: selected };
  }

  const fingerprints = new Set(candidates.map((candidate) => candidate.fingerprint));
  if (fingerprints.size > 1) {
    return {
      kind: "decision-required",
      name,
      choices: candidates.map((candidate) => candidate.agent)
    };
  }

  return { kind: "selected", candidate: candidates[0]! };
}
