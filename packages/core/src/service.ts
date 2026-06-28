import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentAdapter, AgentEntry } from "./agents.js";
import type { AgentId, ManagedSkill, SyncMode } from "./domain.js";
import { createTextDiff, type SkillDiff } from "./diff.js";
import { TransactionJournal } from "./executor.js";
import { parseSkillName } from "./paths.js";
import { parseGitHubSource } from "./paths.js";
import type { AddCandidate, AddResult } from "./planner.js";
import type { StateStore } from "./state-store.js";
import { GitHubInstaller } from "./github.js";
import { inspectSkillTree } from "./tree.js";

export interface SkillPortServiceOptions {
  root: string;
  agents: AgentAdapter[];
  stateStore: StateStore;
  now?: () => Date;
  githubInstaller?: GitHubInstaller;
}

interface Inspection {
  candidates: AddCandidate[];
  entries: Map<AgentId, AgentEntry>;
}

export interface DiscoveredSkill {
  name: string;
  classification: "single-source" | "identical" | "conflict" | "managed" | "error";
  agents: AgentId[];
}

export interface SkillStatusReport {
  name: string;
  overall: "Synced" | "Local changes" | "Missing" | "Error";
  agents: Record<AgentId, string>;
}

export class SkillPortService {
  private readonly now: () => Date;
  private readonly githubInstaller: GitHubInstaller;

  constructor(private readonly options: SkillPortServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.githubInstaller = options.githubInstaller ?? new GitHubInstaller();
  }

  async install(
    url: string,
    subpath?: string,
    from?: AgentId | "github"
  ): Promise<AddResult> {
    const source = parseGitHubSource(url, subpath);
    const downloaded = await this.githubInstaller.download(source);
    const name = parseSkillName(path.basename(subpath ?? source.repo));
    try {
      const external = await inspectSkillTree(downloaded.path);
      const canonical = this.canonicalPath(name);
      const inspection = await this.inspectLocalCopies(name, canonical);
      const differing = inspection.candidates.filter(
        (candidate) => candidate.fingerprint !== external.fingerprint
      );
      if (from && from !== "github") return this.add(name, from);
      if (differing.length > 0 && !from) {
        return {
          kind: "decision-required",
          name,
          choices: ["github", ...inspection.candidates.map((candidate) => candidate.agent)]
        };
      }
      return await this.installDownloaded(name, downloaded.path, source, external.fingerprint);
    } finally {
      await downloaded.cleanup();
    }
  }

  private async installDownloaded(
    name: string,
    sourcePath: string,
    source: import("./domain.js").GitHubSource,
    fingerprint: string
  ): Promise<AddResult> {
    const canonical = this.canonicalPath(name);
    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      if (state.skills[name]) throw new Error(`Skill is already managed: ${name}`);
      const current = await this.inspectLocalCopies(name, canonical);
      const operationRoot = path.join(this.options.root, ".operations", randomUUID());
      const staged = path.join(operationRoot, "staged", name);
      const journal = new TransactionJournal(operationRoot);
      await mkdir(path.dirname(staged), { recursive: true });
      await cp(sourcePath, staged, { recursive: true, dereference: false });
      try {
        for (const agent of this.options.agents) {
          const entry = current.entries.get(agent.id)!;
          if (entry.kind === "local") await journal.backup(entry.path, agent.id);
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
        await this.options.stateStore.save({
          schemaVersion: 1,
          skills: {
            ...state.skills,
            [name]: {
              name,
              agents: modes,
              fingerprint,
              source,
              updatedAt: this.now().toISOString()
            }
          }
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

  async scan(): Promise<DiscoveredSkill[]> {
    const state = await this.options.stateStore.load();
    const names = new Set<string>();
    for (const agent of this.options.agents) {
      const entries = await readdir(agent.root, { withFileTypes: true }).catch(
        (error: unknown) => {
          if (isNodeError(error) && error.code === "ENOENT") return [];
          throw error;
        }
      );
      for (const entry of entries) names.add(entry.name);
    }

    const discovered: DiscoveredSkill[] = [];
    for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
      const agents: AgentId[] = [];
      const fingerprints = new Set<string>();
      let managed = Boolean(state.skills[name]);
      let errored = false;
      for (const agent of this.options.agents) {
        if (!(await hasSkillManifest(agent.skillPath(name)))) continue;
        let entry: AgentEntry;
        try {
          entry = await agent.inspect(name, this.canonicalPath(name));
        } catch {
          // A Skill we cannot inspect (e.g. it bundles a symbolic link such as
          // a .venv) must not abort discovery of every other Skill. Surface it
          // as an errored entry and keep scanning.
          agents.push(agent.id);
          errored = true;
          continue;
        }
        if (entry.kind !== "missing") agents.push(agent.id);
        if (entry.kind === "local") fingerprints.add(entry.fingerprint);
        if (entry.kind === "managed-link") managed = true;
      }
      if (agents.length === 0) continue;
      discovered.push({
        name,
        classification: errored
          ? "error"
          : managed
            ? "managed"
            : agents.length === 1
              ? "single-source"
              : fingerprints.size <= 1
                ? "identical"
                : "conflict",
        agents
      });
    }
    return discovered;
  }

  async list(): Promise<ManagedSkill[]> {
    const state = await this.options.stateStore.load();
    return Object.values(state.skills).sort((a, b) => a.name.localeCompare(b.name));
  }

  async status(nameValue?: string): Promise<SkillStatusReport[]> {
    const state = await this.options.stateStore.load();
    const skills = nameValue
      ? [state.skills[parseSkillName(nameValue)]].filter(
          (skill): skill is ManagedSkill => Boolean(skill)
        )
      : Object.values(state.skills);
    if (nameValue && skills.length === 0) throw new Error(`Skill is not managed: ${nameValue}`);

    const reports: SkillStatusReport[] = [];
    for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
      const canonical = this.canonicalPath(skill.name);
      const canonicalInspection = await inspectCanonical(canonical);
      const agentStates = {} as Record<AgentId, string>;
      let overall: SkillStatusReport["overall"] = canonicalInspection ? "Synced" : "Missing";

      for (const agent of this.options.agents) {
        let entry: AgentEntry | undefined;
        let inspectFailed = false;
        try {
          entry = await agent.inspect(skill.name, canonical);
        } catch {
          inspectFailed = true;
        }
        if (inspectFailed) {
          agentStates[agent.id] = "error";
          overall = "Error";
        } else if (!entry || entry.kind === "missing") {
          agentStates[agent.id] = "missing";
          overall = "Missing";
        } else if (entry.kind === "managed-link") {
          agentStates[agent.id] = "linked";
        } else if (entry.kind === "local") {
          const expected = canonicalInspection?.fingerprint;
          if (entry.fingerprint === expected) agentStates[agent.id] = "copied";
          else {
            agentStates[agent.id] = "local changes";
            if (overall !== "Missing") overall = "Local changes";
          }
        } else {
          agentStates[agent.id] = "foreign link";
          overall = "Error";
        }
      }
      reports.push({ name: skill.name, overall, agents: agentStates });
    }
    return reports;
  }

  async diff(nameValue: string): Promise<SkillDiff> {
    const name = parseSkillName(nameValue);
    const entries = await Promise.all(
      this.options.agents.map((agent) => agent.inspect(name, this.canonicalPath(name)))
    );
    const locals = entries.filter(
      (entry): entry is Extract<AgentEntry, { kind: "local" }> => entry.kind === "local"
    );
    if (locals.length !== 2) throw new Error("Diff requires local copies in both Agents");
    const left = await readBoundedSkillFile(locals[0]!.path);
    const right = await readBoundedSkillFile(locals[1]!.path);
    return createTextDiff(name, "codex/SKILL.md", left, "claude/SKILL.md", right);
  }

  async sync(nameValue: string, source: AgentId | "central"): Promise<AddResult> {
    const name = parseSkillName(nameValue);
    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      const managed = state.skills[name];
      if (!managed) throw new Error(`Skill is not managed: ${name}`);
      const canonical = this.canonicalPath(name);
      const operationRoot = path.join(this.options.root, ".operations", randomUUID());
      const staged = path.join(operationRoot, "staged");
      const sourcePath =
        source === "central"
          ? canonical
          : this.options.agents.find((agent) => agent.id === source)?.skillPath(name);
      if (!sourcePath) throw new Error(`Unknown sync source: ${source}`);
      await cp(sourcePath, staged, { recursive: true, dereference: true });
      const fingerprint = (await inspectCanonical(staged))!.fingerprint;
      const backups = new Map<string, string>();
      const installed: string[] = [];
      try {
        for (const agent of this.options.agents) {
          const destination = agent.skillPath(name);
          const backup = path.join(operationRoot, "backups", agent.id);
          await mkdir(path.dirname(backup), { recursive: true });
          await rename(destination, backup);
          backups.set(destination, backup);
        }
        const canonicalBackup = path.join(operationRoot, "backups", "canonical");
        await rename(canonical, canonicalBackup);
        backups.set(canonical, canonicalBackup);
        await rename(staged, canonical);
        for (const agent of this.options.agents) {
          const destination = agent.skillPath(name);
          installed.push(destination);
          if (managed.agents[agent.id] === "symlink") await agent.installLink(name, canonical);
          else await agent.installCopy(name, canonical);
        }
        const updated = { ...managed, fingerprint, updatedAt: this.now().toISOString() };
        await this.options.stateStore.save({
          schemaVersion: 1,
          skills: { ...state.skills, [name]: updated }
        });
        await rm(operationRoot, { recursive: true, force: true });
        return { kind: "completed", name, agents: managed.agents };
      } catch (error) {
        for (const destination of installed) await rm(destination, { recursive: true, force: true });
        await rm(canonical, { recursive: true, force: true });
        for (const [destination, backup] of [...backups].reverse()) {
          await mkdir(path.dirname(destination), { recursive: true });
          await rename(backup, destination).catch(() => undefined);
        }
        await rm(operationRoot, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async remove(nameValue: string): Promise<{ kind: "completed"; name: string }> {
    const name = parseSkillName(nameValue);
    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      if (!state.skills[name]) throw new Error(`Skill is not managed: ${name}`);
      const canonical = this.canonicalPath(name);
      const operationRoot = path.join(this.options.root, ".operations", randomUUID());
      const stagedRoot = path.join(operationRoot, "staged");
      const backups = new Map<string, string>();
      const restored: string[] = [];
      await mkdir(stagedRoot, { recursive: true });
      for (const agent of this.options.agents) {
        await cp(canonical, path.join(stagedRoot, agent.id), { recursive: true });
      }
      try {
        for (const agent of this.options.agents) {
          const destination = agent.skillPath(name);
          const backup = path.join(operationRoot, "backups", agent.id);
          await mkdir(path.dirname(backup), { recursive: true });
          await rename(destination, backup);
          backups.set(destination, backup);
          await rename(path.join(stagedRoot, agent.id), destination);
          restored.push(destination);
        }
        const canonicalBackup = path.join(operationRoot, "backups", "canonical");
        await rename(canonical, canonicalBackup);
        backups.set(canonical, canonicalBackup);
        const { [name]: removed, ...remaining } = state.skills;
        void removed;
        await this.options.stateStore.save({ schemaVersion: 1, skills: remaining });
        await rm(operationRoot, { recursive: true, force: true });
        return { kind: "completed", name };
      } catch (error) {
        for (const destination of restored) await rm(destination, { recursive: true, force: true });
        for (const [destination, backup] of [...backups].reverse()) {
          await mkdir(path.dirname(destination), { recursive: true });
          await rename(backup, destination).catch(() => undefined);
        }
        await rm(operationRoot, { recursive: true, force: true });
        throw error;
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

async function hasSkillManifest(skillPath: string): Promise<boolean> {
  return stat(path.join(skillPath, "SKILL.md"))
    .then((entry) => entry.isFile())
    .catch((error: unknown) => {
      if (
        isNodeError(error) &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      ) {
        return false;
      }
      throw error;
    });
}

async function inspectCanonical(pathname: string) {
  return inspectSkillTree(pathname).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    if (error instanceof Error && error.message.includes("regular SKILL.md")) return undefined;
    throw error;
  });
}

async function readBoundedSkillFile(root: string): Promise<string> {
  const contents = await readFile(path.join(root, "SKILL.md"));
  if (contents.byteLength > 200 * 1024) throw new Error("SKILL.md is too large to diff");
  if (contents.includes(0)) throw new Error("SKILL.md appears to be binary");
  return contents.toString("utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
      choices: Array<AgentId | "github">;
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
