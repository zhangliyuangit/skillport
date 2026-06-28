export type AgentId = "codex" | "claude";

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
  path?: string;
}

export interface ManagedSkill {
  name: string;
  agents: Record<AgentId, SyncMode>;
  fingerprint: string;
  source?: GitHubSource;
  updatedAt: string;
}
