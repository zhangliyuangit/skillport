import type {
  AddResult,
  AgentConfig,
  DiscoveredSkill,
  ManagedSkill,
  SkillStatusReport,
  SnapshotInfo
} from "@skillport/core";

export interface OutputWriter {
  write(chunk: string): void;
}

type Tone = "green" | "yellow" | "red" | "dim" | "bold" | "cyan";
type Cell = string | { text: string; tone?: Tone | undefined };

const TONE_CODES: Record<Tone, string> = {
  green: "32",
  yellow: "33",
  red: "31",
  dim: "2",
  bold: "1",
  cyan: "36"
};

// Colour only on an interactive terminal, and honour the NO_COLOR convention.
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(value: string, tone?: Tone): string {
  if (!tone || !useColor || value.length === 0) return value;
  return `[${TONE_CODES[tone]}m${value}[0m`;
}

const cellText = (cell: Cell): string => (typeof cell === "string" ? cell : cell.text);
const cellTone = (cell: Cell): Tone | undefined =>
  typeof cell === "string" ? undefined : cell.tone;

function table(headers: string[], rows: Cell[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => cellText(row[column] ?? "").length))
  );
  const renderRow = (cells: Cell[], header: boolean) =>
    cells
      .map((cell, column) => {
        const raw = cellText(cell);
        const padded =
          column === cells.length - 1
            ? raw
            : raw + " ".repeat(Math.max(0, widths[column]! - raw.length));
        return paint(padded, header ? "bold" : cellTone(cell));
      })
      .join("  ");
  return `${[renderRow(headers, true), ...rows.map((row) => renderRow(row, false))].join("\n")}\n`;
}

function agentColumns(rows: Array<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    for (const id of Object.keys(row)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function statusTone(value: string): Tone | undefined {
  return ({ Synced: "green", "Local changes": "yellow", Missing: "red", Error: "red" } as Record<string, Tone>)[value];
}

function agentStateTone(value: string): Tone | undefined {
  return ({ linked: "green", copied: "green", "local changes": "yellow", missing: "red", disabled: "dim", "foreign link": "red", error: "red" } as Record<string, Tone>)[value];
}

function classificationTone(value: string): Tone | undefined {
  return ({ "single-source": "green", identical: "green", managed: "dim", conflict: "yellow", error: "red" } as Record<string, Tone>)[value];
}

export function renderScan(items: DiscoveredSkill[]): string {
  if (items.length === 0) return "No Skills found.\n";
  return table(
    ["SKILL", "AGENTS", "RESULT"],
    items.map((item) => [
      item.name,
      { text: item.agents.join(", "), tone: "dim" as const },
      { text: item.classification, tone: classificationTone(item.classification) }
    ])
  );
}

export function renderAdd(result: AddResult): { text: string; exitCode: number } {
  if (result.kind === "completed") {
    return {
      text: `${paint("✓", "green")} ${result.name} is now managed by SkillPort.\n`,
      exitCode: 0
    };
  }
  return {
    text: [
      paint(`Conflict: different copies of "${result.name}" were found.`, "yellow"),
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
  const agents = agentColumns(items.map((item) => item.agents));
  return table(
    ["SKILL", ...agents.map((id) => id.toUpperCase()), "STATUS"],
    items.map((item) => [
      item.name,
      ...agents.map((id): Cell => {
        const value = item.agents[id] ?? "—";
        return { text: value, tone: agentStateTone(value) };
      }),
      { text: item.overall, tone: statusTone(item.overall) }
    ])
  );
}

export function renderSnapshots(items: SnapshotInfo[]): string {
  if (items.length === 0) return "No snapshots.\n";
  return table(
    ["SNAPSHOT", "LABEL"],
    items.map((item) => [{ text: item.id, tone: "cyan" as const }, { text: item.label ?? "", tone: "dim" as const }])
  );
}

export function renderAgents(items: AgentConfig[]): string {
  if (items.length === 0) return "No Agents configured.\n";
  return table(
    ["AGENT", "ROOT"],
    items.map((item) => [{ text: item.id, tone: "cyan" as const }, { text: item.root, tone: "dim" as const }])
  );
}

export function renderList(items: ManagedSkill[]): string {
  if (items.length === 0) return "No managed Skills.\n";
  const agents = agentColumns(items.map((item) => item.agents));
  const mode = (item: ManagedSkill, id: string): Cell => {
    if (item.disabled?.includes(id)) return { text: "disabled", tone: "dim" };
    return item.agents[id] ?? "—";
  };
  return table(
    ["SKILL", ...agents.map((id) => id.toUpperCase())],
    items.map((item) => [item.name, ...agents.map((id) => mode(item, id))])
  );
}
