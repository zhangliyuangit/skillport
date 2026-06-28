import type {
  AddResult,
  AgentConfig,
  AgentId,
  DiscoveredSkill,
  ManagedSkill,
  SkillDiff,
  SkillStatusReport,
  SnapshotInfo
} from "@skillport/core";
import { parseAgentId } from "@skillport/core";
import { Command, CommanderError } from "commander";
import {
  type OutputWriter,
  renderAdd,
  renderAgents,
  renderList,
  renderScan,
  renderSnapshots,
  renderStatus
} from "./format.js";

export interface AgentAdmin {
  list(): Promise<AgentConfig[]>;
  add(id: string, root: string): Promise<AgentConfig[]>;
  remove(id: string): Promise<AgentConfig[]>;
  populate(id: string): Promise<{ installed: string[]; skipped: string[] }>;
}

export interface CliService {
  scan(): Promise<DiscoveredSkill[]>;
  add(name: string, from?: AgentId): Promise<AddResult>;
  install(url: string, subpath?: string, from?: AgentId | "github"): Promise<AddResult>;
  diff(name: string): Promise<SkillDiff>;
  status(name?: string): Promise<SkillStatusReport[]>;
  sync(name: string, source: AgentId | "central"): Promise<AddResult>;
  enable(name: string, agent: AgentId): Promise<{ kind: "completed"; name: string }>;
  disable(name: string, agent: AgentId): Promise<{ kind: "completed"; name: string }>;
  deleteSkill(agent: AgentId, name: string): Promise<{ kind: "completed"; name: string; agent: AgentId }>;
  remove(name: string): Promise<{ kind: "completed"; name: string }>;
  list(): Promise<ManagedSkill[]>;
  snapshot(label?: string): Promise<SnapshotInfo>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  restoreSnapshot(id: string): Promise<{ restored: string[] }>;
  purge(): Promise<void>;
}

export interface CliDependencies {
  service: CliService;
  stdout: OutputWriter;
  stderr: OutputWriter;
  agents?: AgentAdmin;
  startUi?: () => Promise<string>;
}

class InvalidInputError extends Error {}

export async function runCli(
  args: string[],
  dependencies: CliDependencies
): Promise<number> {
  const { service, stdout, stderr } = dependencies;
  let exitCode = 0;
  const program = new Command()
    .name("skillport")
    .description("Keep Codex and Claude Code Skills in one local repository")
    .version("0.1.1")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => stdout.write(text),
      writeErr: (text) => stderr.write(text)
    });

  program.command("scan").action(async () => {
    stdout.write(renderScan(await service.scan()));
  });

  program
    .command("add")
    .argument("<skill>")
    .option("--from <agent>")
    .action(async (skill: string, options: { from?: string }) => {
      const source = options.from ? parseAgent(options.from) : undefined;
      const result = await service.add(skill, source);
      const rendered = renderAdd(result);
      stdout.write(rendered.text);
      exitCode = rendered.exitCode;
    });

  program.command("diff").argument("<skill>").action(async (skill: string) => {
    stdout.write(`${(await service.diff(skill)).text}\n`);
  });

  program
    .command("install")
    .argument("<github-url>")
    .option("--path <subdirectory>")
    .option("--from <source>")
    .action(
      async (
        url: string,
        options: { path?: string; from?: string }
      ) => {
        const source = options.from
          ? options.from === "github"
            ? "github"
            : parseAgent(options.from)
          : undefined;
        const result = await service.install(url, options.path, source);
        const rendered = renderAdd(result);
        stdout.write(rendered.text);
        exitCode = rendered.exitCode;
      }
    );

  program
    .command("status")
    .argument("[skill]")
    .action(async (skill?: string) => {
      const reports = await service.status(skill);
      stdout.write(renderStatus(reports));
      if (reports.some((report) => report.overall !== "Synced")) exitCode = 4;
    });

  program
    .command("sync")
    .argument("<skill>")
    .requiredOption("--from <source>")
    .action(async (skill: string, options: { from: string }) => {
      const source = options.from === "central" ? "central" : parseAgent(options.from);
      const result = await service.sync(skill, source);
      stdout.write(renderAdd(result).text);
    });

  program
    .command("disable")
    .argument("<skill>")
    .requiredOption("--agent <agent>")
    .action(async (skill: string, options: { agent: string }) => {
      const result = await service.disable(skill, parseAgent(options.agent));
      stdout.write(`${result.name} is now disabled for ${options.agent}.\n`);
    });

  program
    .command("enable")
    .argument("<skill>")
    .requiredOption("--agent <agent>")
    .action(async (skill: string, options: { agent: string }) => {
      const result = await service.enable(skill, parseAgent(options.agent));
      stdout.write(`${result.name} is now enabled for ${options.agent}.\n`);
    });

  program
    .command("delete")
    .argument("<skill>")
    .requiredOption("--agent <agent>")
    .action(async (skill: string, options: { agent: string }) => {
      const result = await service.deleteSkill(parseAgent(options.agent), skill);
      stdout.write(`${result.name} deleted from ${result.agent} (moved to trash).\n`);
    });

  program
    .command("remove")
    .argument("[skill]")
    .option("--all", "stop managing every Skill, leaving independent copies in each Agent")
    .action(async (skill: string | undefined, options: { all?: boolean }) => {
      if (options.all) {
        const skills = await service.list();
        if (skills.length === 0) {
          stdout.write("No managed Skills.\n");
          return;
        }
        const failed: string[] = [];
        for (const managed of skills) {
          try {
            await service.remove(managed.name);
            stdout.write(`${managed.name} is no longer managed by SkillPort.\n`);
          } catch (error) {
            failed.push(managed.name);
            stderr.write(
              `${managed.name}: ${error instanceof Error ? error.message : String(error)}\n`
            );
          }
        }
        if (failed.length > 0) exitCode = 1;
        return;
      }
      if (!skill) throw new InvalidInputError("Provide a Skill name or --all");
      const result = await service.remove(skill);
      stdout.write(`${result.name} is no longer managed by SkillPort.\n`);
    });

  program.command("list").action(async () => {
    stdout.write(renderList(await service.list()));
  });

  const agent = program.command("agent").description("Manage Agent endpoints");
  agent.command("list").action(async () => {
    stdout.write(renderAgents(await requireAgents(dependencies).list()));
  });
  agent
    .command("add")
    .argument("<id>")
    .requiredOption("--root <path>")
    .action(async (id: string, options: { root: string }) => {
      await requireAgents(dependencies).add(id, options.root);
      stdout.write(`Agent ${id} added.\n`);
    });
  agent.command("remove").argument("<id>").action(async (id: string) => {
    await requireAgents(dependencies).remove(id);
    stdout.write(`Agent ${id} removed.\n`);
  });
  agent.command("populate").argument("<id>").action(async (id: string) => {
    const result = await requireAgents(dependencies).populate(parseAgent(id));
    stdout.write(
      `Populated ${id}: installed ${result.installed.length}, skipped ${result.skipped.length}.\n`
    );
    if (result.skipped.length > 0) {
      stdout.write(`Skipped (conflicts/local changes): ${result.skipped.join(", ")}\n`);
    }
  });

  const snapshot = program.command("snapshot").description("Back up and restore state");
  snapshot
    .command("create")
    .option("--label <text>")
    .action(async (options: { label?: string }) => {
      const info = await service.snapshot(options.label);
      stdout.write(`Snapshot created: ${info.id}\n`);
    });
  snapshot.command("list").action(async () => {
    stdout.write(renderSnapshots(await service.listSnapshots()));
  });
  snapshot.command("restore").argument("<id>").action(async (id: string) => {
    const result = await service.restoreSnapshot(id);
    stdout.write(`Restored snapshot ${id} (${result.restored.length} Skills).\n`);
  });

  program
    .command("uninstall")
    .option("--purge", "also delete ~/.skillport (snapshots, trash, state)")
    .action(async (options: { purge?: boolean }) => {
      const skills = await service.list();
      const failed: string[] = [];
      for (const managed of skills) {
        try {
          await service.remove(managed.name);
        } catch (error) {
          failed.push(managed.name);
          stderr.write(
            `${managed.name}: ${error instanceof Error ? error.message : String(error)}\n`
          );
        }
      }
      if (failed.length > 0) {
        exitCode = 1;
        return;
      }
      stdout.write(`${skills.length} Skills detached into independent copies in each Agent.\n`);
      if (options.purge) {
        await service.purge();
        stdout.write("Removed ~/.skillport. Now run: npm uninstall -g skillport\n");
      } else {
        stdout.write("Safe to delete ~/.skillport, then run: npm uninstall -g skillport\n");
      }
    });

  program.command("ui").action(async () => {
    if (!dependencies.startUi) throw new Error("管理页面启动器不可用");
    const url = await dependencies.startUi();
    stdout.write(`管理页面已打开：${url}\n`);
  });

  try {
    await program.parseAsync(["node", "skillport", ...args]);
    return exitCode;
  } catch (error) {
    if (error instanceof InvalidInputError) {
      stderr.write(`${error.message}\n`);
      return 3;
    }
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return 0;
      }
      return 3;
    }
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseAgent(value: string): AgentId {
  try {
    return parseAgentId(value);
  } catch {
    throw new InvalidInputError(`Invalid Agent id: ${value}`);
  }
}

function requireAgents(dependencies: CliDependencies): AgentAdmin {
  if (!dependencies.agents) throw new Error("Agent management is unavailable");
  return dependencies.agents;
}
