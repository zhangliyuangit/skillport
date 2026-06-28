import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentAdapter } from "./agents.js";

async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), "skillport-agent-"));
  const root = path.join(home, ".codex", "skills");
  const canonical = path.join(home, ".skillport", "skills", "pdf");
  await mkdir(root, { recursive: true });
  await mkdir(canonical, { recursive: true });
  await writeFile(path.join(canonical, "SKILL.md"), "# PDF");
  return { home, root, canonical, adapter: new AgentAdapter("codex", root) };
}

describe("AgentAdapter.inspect", () => {
  it("classifies a missing Skill", async () => {
    const { adapter, canonical } = await fixture();
    expect(await adapter.inspect("missing", canonical)).toMatchObject({
      kind: "missing"
    });
  });

  it("classifies a local Skill and fingerprints it", async () => {
    const { adapter, root, canonical } = await fixture();
    const local = path.join(root, "local");
    await mkdir(local);
    await writeFile(path.join(local, "SKILL.md"), "# Local");
    expect(await adapter.inspect("local", canonical)).toMatchObject({
      kind: "local",
      path: local,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it("distinguishes managed and foreign symbolic links", async () => {
    const { adapter, root, canonical, home } = await fixture();
    const foreign = path.join(home, "foreign");
    await mkdir(foreign);
    await symlink(canonical, path.join(root, "managed"));
    await symlink(foreign, path.join(root, "foreign"));

    expect(await adapter.inspect("managed", canonical)).toEqual({
      kind: "managed-link",
      path: path.join(root, "managed"),
      target: canonical
    });
    expect(await adapter.inspect("foreign", canonical)).toEqual({
      kind: "foreign-link",
      path: path.join(root, "foreign"),
      target: foreign
    });
  });
});

describe("AgentAdapter installation", () => {
  it("installs a symbolic link to the canonical Skill", async () => {
    const { adapter, root, canonical } = await fixture();
    await adapter.installLink("pdf", canonical);
    const installed = path.join(root, "pdf");
    expect((await lstat(installed)).isSymbolicLink()).toBe(true);
    expect(path.resolve(root, await readlink(installed))).toBe(canonical);
  });

  it("installs an independent copy", async () => {
    const { adapter, root, canonical } = await fixture();
    await adapter.installCopy("pdf", canonical);
    const installed = path.join(root, "pdf");
    expect((await lstat(installed)).isDirectory()).toBe(true);
    expect(await readFile(path.join(installed, "SKILL.md"), "utf8")).toBe("# PDF");
  });
});
