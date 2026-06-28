/**
 * Identifier for an Agent endpoint (e.g. "codex", "claude", "qoder").
 * Built-in defaults are codex and claude; users can register more via config.
 */
export type AgentId = string;

export type SyncMode = "symlink" | "copy";

export type SkillStatus =
  | "Synced"
  | "Linked"
  | "Local changes"
  | "Conflict"
  | "Missing"
  | "Error";

export interface GitHubSource {
  owner: string;
  repo: string;
  path?: string | undefined;
}

export interface ManagedSkill {
  name: string;
  agents: Record<AgentId, SyncMode>;
  /** Agents the Skill is managed for but currently turned off (link removed). */
  disabled?: AgentId[] | undefined;
  fingerprint: string;
  source?: GitHubSource | undefined;
  updatedAt: string;
}
