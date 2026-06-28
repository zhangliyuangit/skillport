import type {
  AddResult,
  AgentId,
  DiscoveredSkill,
  ManagedSkill,
  SkillDiff,
  SkillStatusReport
} from "@skillport/core";
import { Command, CommanderError } from "commander";
import {
  type OutputWriter,
  renderAdd,
  renderList,
  renderScan,
  renderStatus
} from "./format.js";

export interface CliService {
  scan(): Promise<DiscoveredSkill[]>;
  add(name: string, from?: AgentId): Promise<AddResult>;
  install(url: string, subpath?: string, from?: AgentId | "github"): Promise<AddResult>;
  diff(name: string): Promise<SkillDiff>;
  status(name?: string): Promise<SkillStatusReport[]>;
  sync(name: string, source: AgentId | "central"): Promise<AddResult>;
  remove(name: string): Promise<{ kind: "completed"; name: string }>;
  list(): Promise<ManagedSkill[]>;
}

export interface CliDependencies {
  service: CliService;
  stdout: OutputWriter;
  stderr: OutputWriter;
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
    .version("0.1.0")
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

  program.command("remove").argument("<skill>").action(async (skill: string) => {
    const result = await service.remove(skill);
    stdout.write(`${result.name} is no longer managed by SkillPort.\n`);
  });

  program.command("list").action(async () => {
    stdout.write(renderList(await service.list()));
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
  if (value !== "codex" && value !== "claude") {
    throw new InvalidInputError("Source must be codex or claude");
  }
  return value;
}
