import type {
  AddResult,
  DiscoveredSkill,
  ManagedSkill,
  SkillStatusReport
} from "@skillport/core";

export interface OutputWriter {
  write(chunk: string): void;
}

export function renderScan(items: DiscoveredSkill[]): string {
  if (items.length === 0) return "No Skills found.\n";
  const lines = ["SKILL\tAGENTS\tRESULT"];
  for (const item of items) {
    lines.push(`${item.name}\t${item.agents.join(", ")}\t${item.classification}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderAdd(result: AddResult): { text: string; exitCode: number } {
  if (result.kind === "completed") {
    return {
      text: `${result.name} is now managed by SkillPort.\n`,
      exitCode: 0
    };
  }
  return {
    text: [
      `Conflict: different copies of "${result.name}" were found.`,
      "Choose the source:",
      ...result.choices.map(
        (choice) => `  skillport add ${result.name} --from ${choice}`
      ),
      "No files were changed.",
      ""
    ].join("\n"),
    exitCode: 2
  };
}

export function renderStatus(items: SkillStatusReport[]): string {
  if (items.length === 0) return "No managed Skills.\n";
  const lines = ["SKILL\tCODEX\tCLAUDE\tSTATUS"];
  for (const item of items) {
    lines.push(
      `${item.name}\t${item.agents.codex}\t${item.agents.claude}\t${item.overall}`
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderList(items: ManagedSkill[]): string {
  if (items.length === 0) return "No managed Skills.\n";
  return `${items
    .map(
      (item) =>
        `${item.name}\t${item.agents.codex}\t${item.agents.claude}`
    )
    .join("\n")}\n`;
}
