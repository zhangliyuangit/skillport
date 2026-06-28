import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import type { AgentConfig, DiscoveredSkill, OperationResult, SkillPortApi, SkillSummary } from "./api.js";

function api(): SkillPortApi {
  return {
    listSkills: vi.fn(async (): Promise<SkillSummary[]> => [
      {
        name: "pdf",
        source: { owner: "skillport", repo: "pdf" },
        agents: { codex: "linked", claude: "linked" },
        modes: { codex: "symlink", claude: "symlink" },
        overall: "Synced",
        updatedAt: "2026-06-28T10:00:00.000Z"
      },
      {
        name: "code-review",
        agents: { codex: "local changes", claude: "local changes" },
        modes: { codex: "copy", claude: "copy" },
        overall: "Local changes",
        updatedAt: "2026-06-28T09:00:00.000Z"
      }
    ]),
    discover: vi.fn(async (): Promise<DiscoveredSkill[]> => [
      { name: "work-report", classification: "single-source", agents: ["codex"] }
    ]),
    diff: vi.fn(async (name) => ({
      name,
      truncated: false,
      text: "--- codex/SKILL.md\n+++ claude/SKILL.md\n-old\n+new"
    })),
    preview: vi.fn(async (name) => ({ name, text: "SKILL body", truncated: false })),
    previewAgent: vi.fn(async (_agent, name) => ({ name, text: "SKILL body", truncated: false })),
    add: vi.fn(async (): Promise<OperationResult> => ({ kind: "completed", name: "work-report" })),
    install: vi.fn(async (): Promise<OperationResult> => ({ kind: "completed", name: "pdf" })),
    sync: vi.fn(async (): Promise<OperationResult> => ({ kind: "completed", name: "code-review" })),
    setEnabled: vi.fn(async (): Promise<OperationResult> => ({ kind: "completed", name: "pdf" })),
    deleteSkill: vi.fn(async (): Promise<OperationResult> => ({ kind: "completed", name: "pdf" })),
    remove: vi.fn(async (): Promise<OperationResult> => ({ kind: "completed", name: "pdf" })),
    listAgents: vi.fn(async (): Promise<AgentConfig[]> => [
      { id: "codex", root: "~/.codex/skills" },
      { id: "claude", root: "~/.claude/skills" }
    ]),
    addAgent: vi.fn(async (): Promise<AgentConfig[]> => []),
    removeAgent: vi.fn(async (): Promise<AgentConfig[]> => []),
    populateAgent: vi.fn(async () => ({ installed: [], skipped: [] }))
  };
}

describe("SkillPort app", () => {
  it("renders the Chinese Skills workspace and attention count", async () => {
    render(<App api={api()} />);
    expect(await screen.findByRole("heading", { name: "技能" })).toBeVisible();
    expect(screen.getByText("2 个技能 · 1 项需要处理")).toBeVisible();
    expect(screen.getByRole("row", { name: /pdf/ })).toBeVisible();
  });

  it("turns off a single Agent from the Skills table", async () => {
    const user = userEvent.setup();
    const target = api();
    render(<App api={target} />);
    const row = await screen.findByRole("row", { name: /pdf/ });
    const [codexSwitch] = within(row).getAllByRole("switch");
    await user.click(codexSwitch!);
    expect(target.setEnabled).toHaveBeenCalledWith("pdf", "codex", false);
  });

  it("opens the conflict inspector and exposes explicit source actions", async () => {
    const user = userEvent.setup();
    render(<App api={api()} />);
    const row = await screen.findByRole("row", { name: /code-review/ });
    await user.click(row);
    expect(await screen.findByText("差异")).toBeVisible();
    expect(screen.getByRole("button", { name: "使用 codex 版本" })).toBeVisible();
    expect(screen.getByRole("button", { name: "使用 claude 版本" })).toBeVisible();
    expect(screen.getByRole("button", { name: "使用中心版本" })).toBeVisible();
  });

  it("scans Discover and adds a local Skill", async () => {
    const user = userEvent.setup();
    const target = api();
    render(<App api={target} />);
    await user.click(screen.getByRole("button", { name: "发现" }));
    const row = await screen.findByRole("row", { name: /work-report/ });
    await user.click(within(row).getByRole("button", { name: "纳入管理" }));
    expect(target.add).toHaveBeenCalledWith("work-report", "codex");
  });

  it("installs a GitHub subdirectory through the modal", async () => {
    const user = userEvent.setup();
    const target = api();
    render(<App api={target} />);
    await screen.findByRole("heading", { name: "技能" });
    await user.click(screen.getByRole("button", { name: "从 GitHub 安装" }));
    await user.type(
      screen.getByLabelText("仓库地址"),
      "https://github.com/acme/skills"
    );
    await user.type(screen.getByLabelText("Skill 子目录"), "skills/pdf");
    await user.click(screen.getByRole("button", { name: "安装" }));
    expect(target.install).toHaveBeenCalledWith(
      "https://github.com/acme/skills",
      "skills/pdf"
    );
  });

  it("lists and adds Agents in Settings", async () => {
    const user = userEvent.setup();
    const target = api();
    render(<App api={target} />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByText("~/.codex/skills")).toBeVisible();
    expect(screen.getByText("~/.claude/skills")).toBeVisible();

    await user.type(screen.getByLabelText("Agent 名称"), "qoder");
    await user.type(screen.getByLabelText("Skill 目录（绝对路径）"), "/Users/me/.qoder/skills");
    await user.click(screen.getByRole("button", { name: "添加 Agent" }));
    expect(target.addAgent).toHaveBeenCalledWith("qoder", "/Users/me/.qoder/skills");
  });
});
