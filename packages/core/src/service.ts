import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentAdapter, AgentEntry } from "./agents.js";
import type { AgentId, ManagedSkill, SyncMode } from "./domain.js";
import { createTextDiff, type SkillDiff } from "./diff.js";
import { TransactionJournal } from "./executor.js";
import { parseSkillName } from "./paths.js";
import { parseGitHubSource } from "./paths.js";
import type { AddCandidate, AddResult } from "./planner.js";
import type { SkillPortState, StateStore } from "./state-store.js";
import { GitHubInstaller } from "./github.js";
import { inspectSkillTree } from "./tree.js";
import { readSkillContent, readSkillDescription } from "./manifest.js";
import { SnapshotStore, type SnapshotInfo } from "./snapshots.js";

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
  description?: string;
}

export interface SkillStatusReport {
  name: string;
  overall: "Synced" | "Local changes" | "Missing" | "Error";
  agents: Record<AgentId, string>;
  description?: string;
}

export interface Diagnosis {
  name: string;
  agent?: AgentId;
  kind: "missing" | "dangling" | "drift" | "orphan" | "foreign" | "broken";
  detail: string;
  fixable: boolean;
}

export class SkillPortService {
  private readonly now: () => Date;
  private readonly githubInstaller: GitHubInstaller;
  private readonly snapshots: SnapshotStore;
  private agentAdapters: AgentAdapter[];

  constructor(private readonly options: SkillPortServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.githubInstaller = options.githubInstaller ?? new GitHubInstaller();
    this.snapshots = new SnapshotStore(options.root, this.now);
    this.agentAdapters = options.agents;
  }

  async snapshot(label?: string): Promise<SnapshotInfo> {
    return this.options.stateStore.withLock(() => this.snapshots.create(label));
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    return this.snapshots.list();
  }

  /** Deletes the entire SkillPort home (central copies, state, snapshots, trash). */
  async purge(): Promise<void> {
    await rm(this.options.root, { recursive: true, force: true });
  }

  /** Scans for integrity problems across managed state, central copies and Agents. */
  async doctor(): Promise<Diagnosis[]> {
    const state = await this.options.stateStore.load();
    const centralRoot = path.resolve(this.options.root, "skills");
    const issues: Diagnosis[] = [];

    for (const [name, managed] of Object.entries(state.skills)) {
      const canonical = this.canonicalPath(name);
      const central = await inspectCanonical(canonical);
      if (!central) {
        issues.push({ name, kind: "broken", detail: "中心副本缺失", fixable: false });
        continue;
      }
      if (central.fingerprint !== managed.fingerprint) {
        issues.push({ name, kind: "drift", detail: "中心内容与记录指纹不一致", fixable: false });
      }
      for (const agent of this.enabledAgents(managed)) {
        let entry: AgentEntry;
        try {
          entry = await agent.inspect(name, canonical);
        } catch {
          issues.push({ name, agent: agent.id, kind: "foreign", detail: "无法读取该端副本", fixable: false });
          continue;
        }
        if (entry.kind === "missing") {
          issues.push({ name, agent: agent.id, kind: "missing", detail: "该端缺少链接", fixable: true });
        } else if (entry.kind === "foreign-link") {
          issues.push({ name, agent: agent.id, kind: "foreign", detail: "指向无关目标", fixable: false });
        } else if (entry.kind === "local" && entry.fingerprint !== central.fingerprint) {
          issues.push({ name, agent: agent.id, kind: "drift", detail: "该端副本与中心不一致", fixable: false });
        }
      }
    }

    for (const agent of this.agentAdapters) {
      const entries = await readdir(agent.root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const target = agent.skillPath(entry.name);
        const linkStat = await lstat(target).catch(() => undefined);
        if (!linkStat?.isSymbolicLink()) continue;
        const resolved = path.resolve(path.dirname(target), await readlink(target));
        if (!resolved.startsWith(centralRoot + path.sep)) continue;
        if (!(await pathExists(resolved))) {
          issues.push({ name: entry.name, agent: agent.id, kind: "dangling", detail: "软链接指向已删除的中心副本", fixable: true });
        }
      }
    }

    const centralEntries = await readdir(centralRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of centralEntries) {
      if (entry.isDirectory() && !state.skills[entry.name]) {
        issues.push({ name: entry.name, kind: "orphan", detail: "中心副本不在受管状态中", fixable: false });
      }
    }

    return issues.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Fixes the auto-fixable problems (missing links, dangling links). */
  async repair(): Promise<{ fixed: number; remaining: Diagnosis[] }> {
    return this.options.stateStore.withLock(async () => {
      const before = (await this.doctor()).filter((issue) => issue.fixable).length;
      const state = await this.options.stateStore.load();
      await this.reconcileLinks(state);
      const remaining = await this.doctor();
      const fixed = before - remaining.filter((issue) => issue.fixable).length;
      return { fixed, remaining };
    });
  }

  /**
   * Restores central content and managed state from a snapshot, taking a fresh
   * snapshot of the current state first, then re-aligning Agent links.
   */
  async restoreSnapshot(id: string): Promise<{ restored: string[] }> {
    return this.options.stateStore.withLock(async () => {
      if (!(await this.snapshots.exists(id))) throw new Error(`Snapshot not found: ${id}`);
      await this.snapshots.create(`before-restore-${id}`);

      const snapshotDir = this.snapshots.pathFor(id);
      const central = path.join(this.options.root, "skills");
      await rm(central, { recursive: true, force: true });
      const snapshotSkills = path.join(snapshotDir, "skills");
      if (await pathExists(snapshotSkills)) {
        await cp(snapshotSkills, central, { recursive: true, dereference: false });
      } else {
        await mkdir(central, { recursive: true });
      }

      const snapshotState = path.join(snapshotDir, "state.json");
      const stateDestination = path.join(this.options.root, "state.json");
      if (await pathExists(snapshotState)) {
        await cp(snapshotState, stateDestination);
      } else {
        await rm(stateDestination, { force: true });
      }

      const state = await this.options.stateStore.load();
      await this.reconcileLinks(state);
      return { restored: Object.keys(state.skills) };
    });
  }

  private async reconcileLinks(state: SkillPortState): Promise<void> {
    const centralRoot = path.resolve(this.options.root, "skills");
    for (const agent of this.agentAdapters) {
      const entries = await readdir(agent.root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const target = agent.skillPath(entry.name);
        const linkStat = await lstat(target).catch(() => undefined);
        if (!linkStat?.isSymbolicLink()) continue;
        const resolved = path.resolve(path.dirname(target), await readlink(target));
        if (!resolved.startsWith(centralRoot + path.sep)) continue; // not one of ours
        const managed = state.skills[entry.name];
        const enabled = managed && !managed.disabled?.includes(agent.id);
        if (!enabled || !(await pathExists(resolved))) {
          await rm(target, { recursive: true, force: true });
        }
      }
    }
    for (const [name, managed] of Object.entries(state.skills)) {
      for (const agent of this.enabledAgents(managed)) {
        const canonical = this.canonicalPath(name);
        const entry = await agent.inspect(name, canonical).catch(() => undefined);
        if (!entry || entry.kind !== "missing") continue;
        try {
          await agent.installLink(name, canonical);
        } catch {
          await agent.installCopy(name, canonical);
        }
      }
    }
  }

  /** Replace the live Agent list (used when agents are added/removed at runtime). */
  setAgents(agents: AgentAdapter[]): void {
    this.agentAdapters = agents;
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
        for (const agent of this.agentAdapters) {
          const entry = current.entries.get(agent.id)!;
          if (entry.kind === "local") await journal.backup(entry.path, agent.id);
        }
        await mkdir(path.dirname(canonical), { recursive: true });
        await rename(staged, canonical);
        const modes = {} as Record<AgentId, SyncMode>;
        for (const agent of this.agentAdapters) {
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
        for (const agent of this.agentAdapters) {
          const entry = current.entries.get(agent.id)!;
          if (entry.kind === "local") {
            await journal.backup(entry.path, agent.id);
          }
        }

        await mkdir(path.dirname(canonical), { recursive: true });
        await rename(staged, canonical);

        const modes = {} as Record<AgentId, SyncMode>;
        for (const agent of this.agentAdapters) {
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
    for (const agent of this.agentAdapters) {
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
      for (const agent of this.agentAdapters) {
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
      const firstAgent = this.agentAdapters.find((agent) => agents.includes(agent.id));
      const description = firstAgent
        ? await readSkillDescription(firstAgent.skillPath(name))
        : undefined;
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
        agents,
        ...(description ? { description } : {})
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

      for (const agent of this.agentAdapters) {
        if (skill.disabled?.includes(agent.id)) {
          agentStates[agent.id] = "disabled";
          continue;
        }
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
      const description = await readSkillDescription(canonical);
      reports.push({
        name: skill.name,
        overall,
        agents: agentStates,
        ...(description ? { description } : {})
      });
    }
    return reports;
  }

  /**
   * Returns the SKILL.md text of a Skill for preview — from the central copy
   * by default, or from a specific Agent's copy when `agentId` is given.
   */
  async preview(
    nameValue: string,
    agentId?: AgentId
  ): Promise<{ name: string; text: string; truncated: boolean }> {
    const name = parseSkillName(nameValue);
    const root = agentId ? this.agentAdapter(agentId).skillPath(name) : this.canonicalPath(name);
    const { text, truncated } = await readSkillContent(root);
    return { name, text, truncated };
  }

  async diff(nameValue: string): Promise<SkillDiff> {
    const name = parseSkillName(nameValue);
    const entries = await Promise.all(
      this.agentAdapters.map((agent) => agent.inspect(name, this.canonicalPath(name)))
    );
    const locals = this.agentAdapters
      .map((agent, index) => ({ agent: agent.id, entry: entries[index]! }))
      .filter(
        (candidate): candidate is { agent: AgentId; entry: Extract<AgentEntry, { kind: "local" }> } =>
          candidate.entry.kind === "local"
      );
    if (locals.length < 2) throw new Error("Diff requires local copies in at least two Agents");
    const [left, right] = locals;
    const leftText = await readBoundedSkillFile(left!.entry.path);
    const rightText = await readBoundedSkillFile(right!.entry.path);
    return createTextDiff(
      name,
      `${left!.agent}/SKILL.md`,
      leftText,
      `${right!.agent}/SKILL.md`,
      rightText
    );
  }

  async sync(nameValue: string, source: AgentId | "central"): Promise<AddResult> {
    const name = parseSkillName(nameValue);
    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      const managed = state.skills[name];
      if (!managed) throw new Error(`Skill is not managed: ${name}`);
      // sync overwrites copies with the chosen version; snapshot first so it is undoable.
      await this.snapshots.create(`before-sync-${name}`);
      const canonical = this.canonicalPath(name);
      const operationRoot = path.join(this.options.root, ".operations", randomUUID());
      const staged = path.join(operationRoot, "staged");
      const sourcePath =
        source === "central"
          ? canonical
          : this.agentAdapters.find((agent) => agent.id === source)?.skillPath(name);
      if (!sourcePath) throw new Error(`Unknown sync source: ${source}`);
      if (source !== "central" && managed.disabled?.includes(source)) {
        throw new Error(`${source} is disabled for ${name}; enable it before syncing from it`);
      }
      await cp(sourcePath, staged, { recursive: true, dereference: true });
      const fingerprint = (await inspectCanonical(staged))!.fingerprint;
      const targets = this.enabledAgents(managed);
      const backups = new Map<string, string>();
      const installed: string[] = [];
      try {
        for (const agent of targets) {
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
        const modes = {} as Record<AgentId, SyncMode>;
        for (const id of managed.disabled ?? []) {
          if (managed.agents[id]) modes[id] = managed.agents[id]!;
        }
        for (const agent of targets) {
          const destination = agent.skillPath(name);
          installed.push(destination);
          if (managed.agents[agent.id] === "copy") {
            await agent.installCopy(name, canonical);
            modes[agent.id] = "copy";
          } else {
            try {
              await agent.installLink(name, canonical);
              modes[agent.id] = "symlink";
            } catch {
              await agent.installCopy(name, canonical);
              modes[agent.id] = "copy";
            }
          }
        }
        const updated = {
          ...managed,
          agents: modes,
          fingerprint,
          updatedAt: this.now().toISOString()
        };
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

  async disable(
    nameValue: string,
    agentId: AgentId
  ): Promise<{ kind: "completed"; name: string }> {
    const name = parseSkillName(nameValue);
    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      const managed = state.skills[name];
      if (!managed) throw new Error(`Skill is not managed: ${name}`);
      if (managed.disabled?.includes(agentId)) return { kind: "completed", name };
      if (this.enabledAgents(managed).length <= 1) {
        throw new Error(`Cannot disable the last active Agent for ${name}; use remove instead`);
      }

      const agent = this.agentAdapter(agentId);
      const canonical = this.canonicalPath(name);
      const entry = await agent.inspect(name, canonical);
      if (entry.kind === "foreign-link") {
        throw new Error(`Refusing to touch unrelated symbolic link: ${entry.path}`);
      }
      if (entry.kind === "local") {
        const central = await inspectCanonical(canonical);
        if (!central || central.fingerprint !== entry.fingerprint) {
          throw new Error(`${agentId} has local changes; sync before disabling ${name}`);
        }
      }

      const operationRoot = path.join(this.options.root, ".operations", randomUUID());
      const backup = path.join(operationRoot, agentId);
      await mkdir(operationRoot, { recursive: true });
      if (entry.kind !== "missing") await rename(agent.skillPath(name), backup);
      try {
        await this.options.stateStore.save({
          schemaVersion: 1,
          skills: {
            ...state.skills,
            [name]: {
              ...managed,
              disabled: [...(managed.disabled ?? []), agentId],
              updatedAt: this.now().toISOString()
            }
          }
        });
        await rm(operationRoot, { recursive: true, force: true });
        return { kind: "completed", name };
      } catch (error) {
        if (entry.kind !== "missing") {
          await rename(backup, agent.skillPath(name)).catch(() => undefined);
        }
        await rm(operationRoot, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async enable(
    nameValue: string,
    agentId: AgentId
  ): Promise<{ kind: "completed"; name: string }> {
    const name = parseSkillName(nameValue);
    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      const managed = state.skills[name];
      if (!managed) throw new Error(`Skill is not managed: ${name}`);
      if (!managed.disabled?.includes(agentId)) return { kind: "completed", name };

      const agent = this.agentAdapter(agentId);
      const canonical = this.canonicalPath(name);
      const entry = await agent.inspect(name, canonical);
      if (entry.kind !== "missing") {
        throw new Error(`Refusing to overwrite existing path: ${agent.skillPath(name)}`);
      }

      let mode: SyncMode = managed.agents[agentId] ?? "symlink";
      try {
        await agent.installLink(name, canonical);
        mode = "symlink";
      } catch {
        await agent.installCopy(name, canonical);
        mode = "copy";
      }
      const remaining = (managed.disabled ?? []).filter((id) => id !== agentId);
      await this.options.stateStore.save({
        schemaVersion: 1,
        skills: {
          ...state.skills,
          [name]: {
            ...managed,
            agents: { ...managed.agents, [agentId]: mode },
            disabled: remaining.length ? remaining : undefined,
            updatedAt: this.now().toISOString()
          }
        }
      });
      return { kind: "completed", name };
    });
  }

  /**
   * Installs every managed Skill into `agentId` from the central copy.
   * Skips Skills the Agent already has, has its own version of, or has turned
   * off — useful right after registering a new Agent.
   */
  async populate(
    agentId: AgentId
  ): Promise<{ installed: string[]; skipped: string[] }> {
    const agent = this.agentAdapter(agentId);
    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      const skills: Record<string, ManagedSkill> = { ...state.skills };
      const installed: string[] = [];
      const skipped: string[] = [];
      for (const [name, managed] of Object.entries(state.skills)) {
        if (managed.disabled?.includes(agentId)) {
          skipped.push(name);
          continue;
        }
        const canonical = this.canonicalPath(name);
        const central = await inspectCanonical(canonical);
        if (!central) {
          skipped.push(name);
          continue;
        }
        let entry: AgentEntry;
        try {
          entry = await agent.inspect(name, canonical);
        } catch {
          skipped.push(name);
          continue;
        }
        if (entry.kind === "managed-link") continue;
        if (entry.kind === "foreign-link") {
          skipped.push(name);
          continue;
        }
        if (entry.kind === "local") {
          if (entry.fingerprint === central.fingerprint) {
            if (managed.agents[agentId] !== "copy") {
              skills[name] = {
                ...managed,
                agents: { ...managed.agents, [agentId]: "copy" }
              };
            }
            continue;
          }
          skipped.push(name);
          continue;
        }
        let mode: SyncMode;
        try {
          await agent.installLink(name, canonical);
          mode = "symlink";
        } catch {
          await agent.installCopy(name, canonical);
          mode = "copy";
        }
        skills[name] = {
          ...skills[name]!,
          agents: { ...skills[name]!.agents, [agentId]: mode },
          updatedAt: this.now().toISOString()
        };
        installed.push(name);
      }
      await this.options.stateStore.save({ schemaVersion: 1, skills });
      return { installed, skipped };
    });
  }

  /**
   * Removes an unmanaged Skill from a single Agent by moving it into the
   * SkillPort trash (recoverable). Refuses managed Skills and symbolic links.
   */
  async deleteSkill(
    agentId: AgentId,
    nameValue: string
  ): Promise<{ kind: "completed"; name: string; agent: AgentId }> {
    const name = parseSkillName(nameValue);
    const agent = this.agentAdapter(agentId);
    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      if (state.skills[name]) {
        throw new Error(`${name} is managed; use disable or remove instead of delete`);
      }
      const entry = await agent.inspect(name, this.canonicalPath(name));
      if (entry.kind === "missing") {
        throw new Error(`Skill not found in ${agentId}: ${name}`);
      }
      if (entry.kind === "managed-link" || entry.kind === "foreign-link") {
        throw new Error(`Refusing to delete a symbolic link: ${entry.path}`);
      }
      const trash = path.join(this.options.root, "trash");
      await mkdir(trash, { recursive: true });
      const stamp = this.now().toISOString().replace(/[:.]/g, "-");
      const destination = path.join(trash, `${agentId}__${name}__${stamp}`);
      try {
        await rename(entry.path, destination);
      } catch (error) {
        if (isNodeError(error) && error.code === "EXDEV") {
          await cp(entry.path, destination, { recursive: true, dereference: false });
          await rm(entry.path, { recursive: true, force: true });
        } else {
          throw error;
        }
      }
      return { kind: "completed", name, agent: agentId };
    });
  }

  async remove(nameValue: string): Promise<{ kind: "completed"; name: string }> {
    const name = parseSkillName(nameValue);
    return this.options.stateStore.withLock(async () => {
      const state = await this.options.stateStore.load();
      const managed = state.skills[name];
      if (!managed) throw new Error(`Skill is not managed: ${name}`);
      const canonical = this.canonicalPath(name);
      // Disabled Agents have no link to leave behind; only restore active ones.
      const targets = this.enabledAgents(managed);
      const operationRoot = path.join(this.options.root, ".operations", randomUUID());
      const stagedRoot = path.join(operationRoot, "staged");
      const backups = new Map<string, string>();
      const restored: string[] = [];
      await mkdir(stagedRoot, { recursive: true });
      for (const agent of targets) {
        await cp(canonical, path.join(stagedRoot, agent.id), { recursive: true });
      }
      try {
        for (const agent of targets) {
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

  private agentAdapter(agentId: AgentId): AgentAdapter {
    const agent = this.agentAdapters.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`Unknown Agent: ${agentId}`);
    return agent;
  }

  private enabledAgents(managed: ManagedSkill): AgentAdapter[] {
    return this.agentAdapters.filter((agent) => !managed.disabled?.includes(agent.id));
  }

  private async inspectLocalCopies(
    name: string,
    canonical: string
  ): Promise<Inspection> {
    const candidates: AddCandidate[] = [];
    const entries = new Map<AgentId, AgentEntry>();
    for (const agent of this.agentAdapters) {
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

async function pathExists(target: string): Promise<boolean> {
  return stat(target).then(() => true).catch(() => false);
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
