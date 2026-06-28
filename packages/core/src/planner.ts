import type { AgentId, SyncMode } from "./domain.js";

export type AddResult =
  | {
      kind: "completed";
      name: string;
      agents: Record<AgentId, SyncMode>;
    }
  | {
      kind: "decision-required";
      name: string;
      choices: Array<AgentId | "github">;
    };

export interface AddCandidate {
  agent: AgentId;
  path: string;
  fingerprint: string;
}
