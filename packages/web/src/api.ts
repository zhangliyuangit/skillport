export type AgentId = "codex" | "claude";
export type SourceChoice = AgentId | "github" | "central";

export interface SkillSummary {
  name: string;
  source?: { owner: string; repo: string; path?: string };
  agents: Record<AgentId, string>;
  modes: Record<AgentId, "symlink" | "copy">;
  overall: "Synced" | "Local changes" | "Missing" | "Error";
  updatedAt: string;
}

export interface DiscoveredSkill {
  name: string;
  classification: "single-source" | "identical" | "conflict" | "managed" | "error";
  agents: AgentId[];
}

export interface SkillDiff {
  name: string;
  text: string;
  truncated: boolean;
}

export interface OperationResult {
  kind: "completed";
  name: string;
}

export interface SkillPortApi {
  listSkills(): Promise<SkillSummary[]>;
  discover(): Promise<DiscoveredSkill[]>;
  diff(name: string): Promise<SkillDiff>;
  add(name: string, from?: AgentId): Promise<OperationResult>;
  install(url: string, path?: string): Promise<OperationResult>;
  sync(name: string, from: AgentId | "central"): Promise<OperationResult>;
  remove(name: string): Promise<OperationResult>;
}

export function createHttpApi(): SkillPortApi {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  if (window.location.hash) history.replaceState(null, "", window.location.pathname);

  async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetch(pathname, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-skillport-token": token,
        ...init?.headers
      }
    });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.message ?? "操作失败"), body);
    return body as T;
  }

  return {
    listSkills: () => request("/api/skills"),
    discover: () => request("/api/discover"),
    diff: (name) => request(`/api/skills/${encodeURIComponent(name)}/diff`),
    add: (name, from) =>
      request(`/api/skills/${encodeURIComponent(name)}/add`, {
        method: "POST",
        body: JSON.stringify({ ...(from ? { from } : {}) })
      }),
    install: (url, path) =>
      request("/api/install", {
        method: "POST",
        body: JSON.stringify({ url, ...(path ? { path } : {}) })
      }),
    sync: (name, from) =>
      request(`/api/skills/${encodeURIComponent(name)}/sync`, {
        method: "POST",
        body: JSON.stringify({ from })
      }),
    remove: (name) =>
      request(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" })
  };
}
