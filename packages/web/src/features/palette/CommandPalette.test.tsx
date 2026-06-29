import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SkillPortApi, SkillSummary } from "../../api.js";
import { CommandPalette } from "./CommandPalette.js";

function skill(name: string): SkillSummary {
  return { name, agents: {}, modes: {}, overall: "Synced", updatedAt: "" };
}

function api(skills: SkillSummary[]): SkillPortApi {
  return { listSkills: vi.fn(async () => skills) } as unknown as SkillPortApi;
}

describe("CommandPalette", () => {
  it("filters skills and activates the chosen one with Enter", async () => {
    const user = userEvent.setup();
    const onSelectSkill = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        api={api([skill("alpha"), skill("beta")])}
        onClose={onClose}
        onNavigate={vi.fn()}
        onSelectSkill={onSelectSkill}
      />
    );
    await screen.findByText("alpha");

    await user.type(screen.getByLabelText("搜索技能或跳转"), "alph");
    expect(screen.queryByText("beta")).toBeNull();

    await user.keyboard("{Enter}");
    expect(onSelectSkill).toHaveBeenCalledWith("alpha");
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates when a destination is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <CommandPalette
        api={api([])}
        onClose={vi.fn()}
        onNavigate={onNavigate}
        onSelectSkill={vi.fn()}
      />
    );
    await user.click(await screen.findByText("发现"));
    expect(onNavigate).toHaveBeenCalledWith("discover");
  });
});
