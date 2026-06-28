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
      choices: AgentId[];
    };

export interface AddCandidate {
  agent: AgentId;
  path: string;
  fingerprint: string;
}
