import type { AddResult } from "@skillport/core";
import { describe, expect, it } from "vitest";
import { buildApp, type ApiService } from "./app.js";

const token = "test-token";
const origin = "http://127.0.0.1:43111";

function service(overrides: Partial<ApiService> = {}): ApiService {
  return {
    scan: async () => [],
    list: async () => [],
    status: async () => [],
    diff: async (name) => ({ name, text: "diff", truncated: false }),
    preview: async (name) => ({ name, text: "body", truncated: false }),
    add: async (name) => completed(name),
    install: async () => completed("installed"),
    create: async (name) => completed(name),
    sync: async (name) => completed(name),
    update: async (name) => ({ name, updated: false }),
    enable: async (name) => ({ kind: "completed", name }),
    disable: async (name) => ({ kind: "completed", name }),
    deleteSkill: async (agent, name) => ({ kind: "completed", name, agent }),
    remove: async (name) => ({ kind: "completed", name }),
    doctor: async () => [],
    repair: async () => ({ fixed: 0, remaining: [] }),
    listSnapshots: async () => [],
    snapshot: async (label) => ({
      id: "2026-01-01T00-00-00-000Z",
      createdAt: "2026-01-01T00-00-00-000Z",
      ...(label ? { label } : {})
    }),
    restoreSnapshot: async () => ({ restored: [] }),
    ...overrides
  };
}

function completed(name: string): AddResult {
  return {
    kind: "completed",
    name,
    agents: { codex: "symlink", claude: "symlink" }
  };
}

function requestHeaders() {
  return { origin, "x-skillport-token": token };
}

describe("API protection", () => {
  it("rejects a missing token", async () => {
    const app = buildApp({ service: service(), token, origin });
    const response = await app.inject({ method: "GET", url: "/api/skills" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a foreign origin", async () => {
    const app = buildApp({ service: service(), token, origin });
    const response = await app.inject({
      method: "GET",
      url: "/api/skills",
      headers: { origin: "https://evil.example", "x-skillport-token": token }
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe("API resources", () => {
  it("combines managed inventory with live status", async () => {
    const app = buildApp({
      token,
      origin,
      service: service({
        list: async () => [
          {
            name: "pdf",
            agents: { codex: "symlink", claude: "symlink" },
            fingerprint: "abc",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        ],
        status: async () => [
          {
            name: "pdf",
            overall: "Synced",
            agents: { codex: "linked", claude: "linked" }
          }
        ]
      })
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/skills",
      headers: requestHeaders()
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        name: "pdf",
        modes: { codex: "symlink", claude: "symlink" },
        agents: { codex: "linked", claude: "linked" },
        overall: "Synced"
      })
    ]);
    await app.close();
  });

  it("returns 409 with explicit choices for conflicts", async () => {
    const app = buildApp({
      token,
      origin,
      service: service({
        add: async () => ({
          kind: "decision-required",
          name: "review",
          choices: ["codex", "claude"]
        })
      })
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/skills/review/add",
      headers: requestHeaders(),
      payload: {}
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "SOURCE_DECISION_REQUIRED",
      choices: ["codex", "claude"]
    });
    await app.close();
  });

  it("validates install input", async () => {
    const app = buildApp({ service: service(), token, origin });
    const response = await app.inject({
      method: "POST",
      url: "/api/install",
      headers: requestHeaders(),
      payload: { url: "not a URL" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_INPUT" });
    await app.close();
  });

  it("maps unexpected errors to a stable response", async () => {
    const app = buildApp({
      token,
      origin,
      service: service({ remove: async () => { throw new Error("permission denied"); } })
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/skills/pdf",
      headers: requestHeaders()
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "OPERATION_FAILED",
      message: "permission denied"
    });
    await app.close();
  });
});

describe("Skill deletion", () => {
  it("deletes a Skill from an Agent", async () => {
    const calls: Array<[string, string]> = [];
    const app = buildApp({
      token,
      origin,
      service: service({
        deleteSkill: async (agent, name) => {
          calls.push([agent, name]);
          return { kind: "completed", name, agent };
        }
      })
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/agents/qoder/skills/junk",
      headers: requestHeaders()
    });
    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([["qoder", "junk"]]);
    await app.close();
  });
});

describe("Agent administration", () => {
  it("lists, adds, and populates Agents", async () => {
    const calls: string[] = [];
    const agents = {
      list: async () => [
        { id: "codex", root: "/c" },
        { id: "qoder", root: "/q" }
      ],
      add: async (id: string, root: string) => {
        calls.push(`add:${id}:${root}`);
        return [];
      },
      remove: async (id: string) => {
        calls.push(`remove:${id}`);
        return [];
      },
      populate: async (id: string) => {
        calls.push(`populate:${id}`);
        return { installed: ["pdf"], skipped: [] };
      }
    };
    const app = buildApp({ service: service(), token, origin, agents });

    const listed = await app.inject({ method: "GET", url: "/api/agents", headers: requestHeaders() });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      { id: "codex", root: "/c" },
      { id: "qoder", root: "/q" }
    ]);

    const added = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: requestHeaders(),
      payload: { id: "qoder", root: "/q" }
    });
    expect(added.statusCode).toBe(200);
    expect(calls).toContain("add:qoder:/q");

    const populated = await app.inject({
      method: "POST",
      url: "/api/agents/qoder/populate",
      headers: requestHeaders()
    });
    expect(populated.statusCode).toBe(200);
    expect(populated.json()).toEqual({ installed: ["pdf"], skipped: [] });

    await app.close();
  });
});

describe("Snapshots", () => {
  it("lists, creates, and restores snapshots", async () => {
    const calls: string[] = [];
    const app = buildApp({
      service: service({
        listSnapshots: async () => [
          { id: "2026-06-29T10-00-00-000Z", createdAt: "2026-06-29T10-00-00-000Z", label: "before-sync-pdf" }
        ],
        snapshot: async (label) => {
          calls.push(`snapshot:${label ?? ""}`);
          return { id: "2026-06-29T12-00-00-000Z", createdAt: "2026-06-29T12-00-00-000Z" };
        },
        restoreSnapshot: async (id) => {
          calls.push(`restore:${id}`);
          return { restored: ["pdf"] };
        }
      }),
      token,
      origin
    });

    const listed = await app.inject({ method: "GET", url: "/api/snapshots", headers: requestHeaders() });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const created = await app.inject({ method: "POST", url: "/api/snapshots", headers: requestHeaders() });
    expect(created.statusCode).toBe(200);
    expect(calls).toContain("snapshot:");

    const restored = await app.inject({
      method: "POST",
      url: "/api/snapshots/2026-06-29T10-00-00-000Z/restore",
      headers: requestHeaders()
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual({ restored: ["pdf"] });
    expect(calls).toContain("restore:2026-06-29T10-00-00-000Z");

    await app.close();
  });
});
