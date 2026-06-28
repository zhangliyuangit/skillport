import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "./state-store.js";

async function temporaryHome(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "skillport-state-"));
}

describe("StateStore", () => {
  it("returns empty version 1 state when the state file is missing", async () => {
    const root = await temporaryHome();
    expect(await new StateStore(root).load()).toEqual({
      schemaVersion: 1,
      skills: {}
    });
  });

  it("saves and reloads version 1 state", async () => {
    const root = await temporaryHome();
    const store = new StateStore(root);
    const state = {
      schemaVersion: 1 as const,
      skills: {
        pdf: {
          name: "pdf",
          agents: { codex: "symlink" as const, claude: "copy" as const },
          fingerprint: "abc123",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      }
    };

    await store.save(state);

    expect(await store.load()).toEqual(state);
    expect(JSON.parse(await readFile(path.join(root, "state.json"), "utf8"))).toEqual(
      state
    );
  });

  it("rejects corrupt state without replacing it", async () => {
    const root = await temporaryHome();
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "state.json"), "{");

    await expect(new StateStore(root).load()).rejects.toThrow(
      "Invalid SkillPort state"
    );
    expect(await readFile(path.join(root, "state.json"), "utf8")).toBe("{");
  });

  it("rejects an unsupported state schema", async () => {
    const root = await temporaryHome();
    await writeFile(
      path.join(root, "state.json"),
      JSON.stringify({ schemaVersion: 2, skills: {} })
    );
    await expect(new StateStore(root).load()).rejects.toThrow(
      "Invalid SkillPort state"
    );
  });

  it("serializes concurrent mutations with an exclusive lock", async () => {
    const root = await temporaryHome();
    const store = new StateStore(root);
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lockAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });

    const first = store.withLock(async () => {
      acquired();
      await held;
    });
    await lockAcquired;
    await expect(store.withLock(async () => undefined)).rejects.toThrow(
      "another operation is running"
    );
    release();
    await first;
    await expect(store.withLock(async () => "done")).resolves.toBe("done");
  });
});
