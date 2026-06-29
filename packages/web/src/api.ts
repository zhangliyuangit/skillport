export type AgentId = string;
export type SourceChoice = AgentId | "github" | "central";

export interface AgentConfig {
  id: string;
  root: string;
}

export interface SkillSummary {
  name: string;
  description?: string;
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
  description?: string;
}

export interface SkillDiff {
  name: string;
  text: string;
  truncated: boolean;
}

export interface SkillContent {
  name: string;
  text: string;
  truncated: boolean;
}

export interface OperationResult {
  kind: "completed";
  name: string;
}

export interface PopulateResult {
  installed: string[];
  skipped: string[];
}

export interface Diagnosis {
  name: string;
  agent?: string;
  kind: "missing" | "dangling" | "drift" | "orphan" | "foreign" | "broken";
  detail: string;
  fixable: boolean;
}

export interface Snapshot {
  id: string;
  createdAt: string;
  label?: string;
}

export interface SkillPortApi {
  listSkills(): Promise<SkillSummary[]>;
  discover(): Promise<DiscoveredSkill[]>;
  diff(name: string): Promise<SkillDiff>;
  preview(name: string): Promise<SkillContent>;
  previewAgent(agent: AgentId, name: string): Promise<SkillContent>;
  add(name: string, from?: AgentId): Promise<OperationResult>;
  install(url: string, path?: string): Promise<OperationResult>;
  createSkill(name: string, description?: string): Promise<OperationResult>;
  sync(name: string, from: AgentId | "central"): Promise<OperationResult>;
  update(name: string): Promise<{ name: string; updated: boolean }>;
  setEnabled(name: string, agent: AgentId, enabled: boolean): Promise<OperationResult>;
  deleteSkill(agent: AgentId, name: string): Promise<OperationResult>;
  remove(name: string): Promise<OperationResult>;
  listAgents(): Promise<AgentConfig[]>;
  addAgent(id: string, root: string): Promise<AgentConfig[]>;
  removeAgent(id: string): Promise<AgentConfig[]>;
  populateAgent(id: string): Promise<PopulateResult>;
  doctor(): Promise<Diagnosis[]>;
  repair(): Promise<{ fixed: number; remaining: Diagnosis[] }>;
  listSnapshots(): Promise<Snapshot[]>;
  createSnapshot(label?: string): Promise<Snapshot>;
  restoreSnapshot(id: string): Promise<{ restored: string[] }>;
}

const TOKEN_STORAGE_KEY = "skillport.token";

function rememberToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // sessionStorage may be unavailable (private mode); rely on the in-memory token.
  }
}

function recallToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function createHttpApi(): SkillPortApi {
  // The launcher delivers a one-time token in the URL hash. Persist it for this
  // tab so a manual refresh (which clears the hash) keeps authenticating.
  const hashToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (hashToken) {
    rememberToken(hashToken);
    history.replaceState(null, "", window.location.pathname);
  }
  const token = hashToken ?? recallToken();

  async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "x-skillport-token": token,
      ...(init?.headers as Record<string, string>)
    };
    // Only declare a JSON body when one is actually sent; otherwise Fastify
    // rejects the empty body for content-type application/json.
    if (init?.body !== undefined && init?.body !== null) {
      headers["content-type"] = "application/json";
    }
    const response = await fetch(pathname, { ...init, headers });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.message ?? "操作失败"), body);
    return body as T;
  }

  return {
    listSkills: () => request("/api/skills"),
    discover: () => request("/api/discover"),
    diff: (name) => request(`/api/skills/${encodeURIComponent(name)}/diff`),
    preview: (name) => request(`/api/skills/${encodeURIComponent(name)}/content`),
    previewAgent: (agent, name) =>
      request(
        `/api/agents/${encodeURIComponent(agent)}/skills/${encodeURIComponent(name)}/content`
      ),
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
    createSkill: (name, description) =>
      request("/api/skills/create", {
        method: "POST",
        body: JSON.stringify({ name, ...(description ? { description } : {}) })
      }),
    sync: (name, from) =>
      request(`/api/skills/${encodeURIComponent(name)}/sync`, {
        method: "POST",
        body: JSON.stringify({ from })
      }),
    update: (name) =>
      request(`/api/skills/${encodeURIComponent(name)}/update`, { method: "POST" }),
    setEnabled: (name, agent, enabled) =>
      request(`/api/skills/${encodeURIComponent(name)}/${enabled ? "enable" : "disable"}`, {
        method: "POST",
        body: JSON.stringify({ agent })
      }),
    deleteSkill: (agent, name) =>
      request(
        `/api/agents/${encodeURIComponent(agent)}/skills/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      ),
    remove: (name) =>
      request(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" }),
    listAgents: () => request("/api/agents"),
    addAgent: (id, root) =>
      request("/api/agents", {
        method: "POST",
        body: JSON.stringify({ id, root })
      }),
    removeAgent: (id) =>
      request(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
    populateAgent: (id) =>
      request(`/api/agents/${encodeURIComponent(id)}/populate`, { method: "POST" }),
    doctor: () => request("/api/doctor"),
    repair: () => request("/api/doctor/repair", { method: "POST" }),
    listSnapshots: () => request("/api/snapshots"),
    createSnapshot: (label) =>
      request("/api/snapshots", {
        method: "POST",
        body: JSON.stringify({ ...(label ? { label } : {}) })
      }),
    restoreSnapshot: (id) =>
      request(`/api/snapshots/${encodeURIComponent(id)}/restore`, { method: "POST" })
  };
}
