import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DiscoveredSkill, OperationResult, SkillPortApi } from "../../api.js";
import { ToastProvider } from "../toast/Toast.js";
import { DiscoverPage } from "./DiscoverPage.js";

const renderDiscover = (api: SkillPortApi) =>
  render(
    <ToastProvider>
      <DiscoverPage api={api} />
    </ToastProvider>
  );

function discoverApi(items: DiscoveredSkill[]): SkillPortApi {
  const remaining = [...items];
  return {
    listSkills: vi.fn(),
    discover: vi.fn(async () => remaining.slice()),
    diff: vi.fn(),
    add: vi.fn(async (name: string): Promise<OperationResult> => {
      const index = remaining.findIndex((item) => item.name === name);
      if (index >= 0) remaining.splice(index, 1);
      return { kind: "completed", name };
    }),
    install: vi.fn(),
    sync: vi.fn(),
    previewAgent: vi.fn(async (_agent: string, name: string) => ({ name, text: "完整内容", truncated: false })),
    deleteSkill: vi.fn(async (_agent: string, name: string): Promise<OperationResult> => {
      const index = remaining.findIndex((item) => item.name === name);
      if (index >= 0) remaining.splice(index, 1);
      return { kind: "completed", name };
    }),
    remove: vi.fn()
  } as unknown as SkillPortApi;
}

describe("DiscoverPage bulk add", () => {
  it("adds every eligible Skill in one click and skips conflicts/errors", async () => {
    const user = userEvent.setup();
    const api = discoverApi([
      { name: "a1", classification: "single-source", agents: ["claude"] },
      { name: "same", classification: "identical", agents: ["codex", "claude"] },
      { name: "diagram", classification: "conflict", agents: ["codex", "claude"] },
      { name: "broken", classification: "error", agents: ["codex"] }
    ]);
    renderDiscover(api);

    const bulk = await screen.findByRole("button", { name: /一键纳入（2）/ });
    await user.click(bulk);

    // Only the two addable Skills are sent to the API.
    expect(api.add).toHaveBeenCalledTimes(2);
    expect(api.add).toHaveBeenCalledWith("a1", "claude");
    expect(api.add).toHaveBeenCalledWith("same", "codex");
    expect(api.add).not.toHaveBeenCalledWith("diagram", expect.anything());
    expect(api.add).not.toHaveBeenCalledWith("broken", expect.anything());

    // Summary reflects 2 added and 2 left for manual handling.
    expect(await screen.findByText(/已纳入 2 个/)).toBeVisible();
    expect(screen.getByText(/2 个需手动处理/)).toBeVisible();
  });

  it("disables the broken Skill's row button", async () => {
    renderDiscover(discoverApi([{ name: "broken", classification: "error", agents: ["codex"] }]));
    const row = await screen.findByRole("row", { name: /broken/ });
    expect(within(row).getByRole("button", { name: "纳入管理" })).toBeDisabled();
  });

  it("previews a Skill's SKILL.md in a modal", async () => {
    const user = userEvent.setup();
    const api = discoverApi([
      { name: "junk", classification: "single-source", agents: ["codex"] }
    ]);
    renderDiscover(api);
    const row = await screen.findByRole("row", { name: /junk/ });
    await user.click(within(row).getByRole("button", { name: "预览" }));
    expect(api.previewAgent).toHaveBeenCalledWith("codex", "junk");
    expect(await screen.findByText("完整内容")).toBeVisible();
  });

  it("filters Skills by the search box", async () => {
    const user = userEvent.setup();
    const api = discoverApi([
      { name: "alpha", classification: "single-source", agents: ["codex"] },
      { name: "beta", classification: "single-source", agents: ["codex"] }
    ]);
    renderDiscover(api);
    await screen.findByRole("row", { name: /alpha/ });
    await user.type(screen.getByLabelText("搜索技能"), "alph");
    expect(screen.queryByRole("row", { name: /beta/ })).toBeNull();
    expect(screen.getByRole("row", { name: /alpha/ })).toBeVisible();
  });

  it("deletes a Skill from its Agents after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = discoverApi([
      { name: "junk", classification: "single-source", agents: ["codex", "claude"] }
    ]);
    renderDiscover(api);
    const row = await screen.findByRole("row", { name: /junk/ });
    await user.click(within(row).getByRole("button", { name: "删除" }));
    expect(api.deleteSkill).toHaveBeenCalledWith("codex", "junk");
    expect(api.deleteSkill).toHaveBeenCalledWith("claude", "junk");
    expect(await screen.findByText(/已删除/)).toBeVisible();
  });
});
