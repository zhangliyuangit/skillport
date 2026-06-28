# SkillPort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first `skillport` CLI and browser management page that safely consolidates Codex and Claude Code Skills, installs public GitHub Skills, detects conflicts, and restores unmanaged copies without data loss.

**Architecture:** An npm workspace separates the filesystem-focused core from the CLI, loopback HTTP server, and React UI. The CLI and server call the same core service; all mutations are planned and validated before filesystem changes, while the web application remains a pure API client.

**Tech Stack:** Node.js 22, TypeScript, npm workspaces, Commander, Zod, Fastify, React, Vite, Vitest, Testing Library, Playwright, tsup.

---

## File Map

```text
package.json                         Workspace scripts and shared tool versions
tsconfig.base.json                   Strict shared TypeScript options
vitest.workspace.ts                  Cross-package test discovery
packages/core/src/domain.ts          Public domain types and status vocabulary
packages/core/src/paths.ts           Home expansion and safe path validation
packages/core/src/tree.ts            Skill validation, walking, and fingerprints
packages/core/src/state-store.ts      Versioned atomic state persistence and lock
packages/core/src/agents.ts           Codex and Claude Code adapters
packages/core/src/planner.ts          Read-only add/remove/sync operation plans
packages/core/src/executor.ts         Transaction execution and rollback
packages/core/src/diff.ts             Bounded text diff generation
packages/core/src/github.ts           Public GitHub archive download and validation
packages/core/src/service.ts          Stable facade consumed by CLI and server
packages/core/src/index.ts            Public exports
packages/cli/src/format.ts            Stable terminal tables and messages
packages/cli/src/program.ts           Commander command definitions
packages/cli/src/main.ts              Executable entry point
packages/server/src/app.ts            Token-protected loopback API
packages/server/src/start.ts          Ephemeral-port server and browser launch
packages/web/src/api.ts               Typed HTTP client
packages/web/src/App.tsx              Application shell and routes
packages/web/src/features/*           Skills, Discover, Settings UI units
tests/fixtures/*                      Safe, conflicting, and malicious Skill fixtures
tests/e2e/skillport.spec.ts           Browser-level local management flow
```

## Phase 1: Core and CLI

### Task 1: Create the TypeScript workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

- [ ] **Step 1: Write the failing workspace smoke test**

```ts
// packages/core/src/index.test.ts
import { describe, expect, it } from "vitest";
import { SKILLPORT_VERSION } from "./index.js";

describe("core package", () => {
  it("exports its state schema version", () => {
    expect(SKILLPORT_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Add workspace configuration and run the failing test**

```json
// package.json
{
  "name": "skillport-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "typecheck": "tsc -b --pretty false"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Run: `npm install && npm test -- packages/core/src/index.test.ts`

Expected: FAIL because `SKILLPORT_VERSION` is not exported.

- [ ] **Step 3: Add strict TypeScript configuration and the minimal export**

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

```ts
// packages/core/src/index.ts
export const SKILLPORT_VERSION = 1 as const;
```

- [ ] **Step 4: Verify the workspace**

Run: `npm test -- packages/core/src/index.test.ts && npm run typecheck`

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.workspace.ts packages/core
git commit -m "chore: scaffold SkillPort workspace"
```

### Task 2: Define domain types and input validation

**Files:**
- Create: `packages/core/src/domain.ts`
- Create: `packages/core/src/paths.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/paths.test.ts`

- [ ] **Step 1: Write failing validation tests**

```ts
import { describe, expect, it } from "vitest";
import { parseSkillName, parseGitHubSource } from "./paths.js";

describe("parseSkillName", () => {
  it.each(["../pdf", "a/b", ".", ""])("rejects unsafe name %j", (name) => {
    expect(() => parseSkillName(name)).toThrow();
  });
  it("accepts a safe directory name", () => {
    expect(parseSkillName("pdf-tools")).toBe("pdf-tools");
  });
});

it("parses a public GitHub repository and safe subpath", () => {
  expect(parseGitHubSource("https://github.com/acme/skills", "skills/pdf")).toEqual({
    owner: "acme", repo: "skills", path: "skills/pdf"
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/core/src/paths.test.ts`

Expected: FAIL because the parsing functions do not exist.

- [ ] **Step 3: Implement public types and parsers**

```ts
// packages/core/src/domain.ts
export type AgentId = "codex" | "claude";
export type SyncMode = "symlink" | "copy";
export type SkillStatus = "Synced" | "Linked" | "Local changes" | "Conflict" | "Missing" | "Error";
export interface GitHubSource { owner: string; repo: string; path?: string }
export interface ManagedSkill {
  name: string;
  agents: Record<AgentId, SyncMode>;
  fingerprint: string;
  source?: GitHubSource;
  updatedAt: string;
}
```

```ts
// packages/core/src/paths.ts
import path from "node:path";
import type { GitHubSource } from "./domain.js";

export function parseSkillName(value: string): string {
  if (!value || value === "." || value === ".." || path.basename(value) !== value || value.includes("\\")) {
    throw new Error(`Invalid Skill name: ${value}`);
  }
  return value;
}

export function parseGitHubSource(url: string, subpath?: string): GitHubSource {
  const parsed = new URL(url);
  const parts = parsed.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parts.length !== 2) {
    throw new Error("Expected https://github.com/<owner>/<repository>");
  }
  if (subpath && (path.isAbsolute(subpath) || subpath.split(/[\\/]/).includes(".."))) {
    throw new Error("GitHub Skill path must stay inside the repository");
  }
  return { owner: parts[0]!, repo: parts[1]!, ...(subpath ? { path: subpath } : {}) };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- packages/core/src/paths.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): define SkillPort domain inputs"
```

### Task 3: Validate and fingerprint Skill trees

**Files:**
- Create: `packages/core/src/tree.ts`
- Create: `tests/fixtures/pdf/SKILL.md`
- Test: `packages/core/src/tree.test.ts`

- [ ] **Step 1: Write tests for deterministic fingerprints and unsafe links**

```ts
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectSkillTree } from "./tree.js";

it("produces the same fingerprint regardless of file creation order", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillport-tree-"));
  const a = path.join(root, "a"); const b = path.join(root, "b");
  await mkdir(a); await mkdir(b);
  await writeFile(path.join(a, "SKILL.md"), "# PDF"); await writeFile(path.join(a, "x.txt"), "x");
  await writeFile(path.join(b, "x.txt"), "x"); await writeFile(path.join(b, "SKILL.md"), "# PDF");
  expect((await inspectSkillTree(a)).fingerprint).toBe((await inspectSkillTree(b)).fingerprint);
});

it("rejects symbolic links inside a Skill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "skillport-link-"));
  await writeFile(path.join(root, "SKILL.md"), "# Unsafe");
  await symlink("/tmp", path.join(root, "escape"));
  await expect(inspectSkillTree(root)).rejects.toThrow("symbolic link");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/core/src/tree.test.ts`

Expected: FAIL because `inspectSkillTree` does not exist.

- [ ] **Step 3: Implement sorted traversal and hashing**

```ts
// packages/core/src/tree.ts
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface TreeInspection { fingerprint: string; files: string[] }

export async function inspectSkillTree(root: string): Promise<TreeInspection> {
  const skillFile = path.join(root, "SKILL.md");
  if (!(await stat(skillFile).catch(() => undefined))?.isFile()) throw new Error("Skill must contain a regular SKILL.md");
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isSymbolicLink()) throw new Error(`Skill contains symbolic link: ${relative}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`Skill contains unsupported file: ${relative}`);
    }
  }
  await walk(root);
  const hash = createHash("sha256");
  for (const file of files) hash.update(file).update("\0").update(await readFile(path.join(root, file))).update("\0");
  return { files, fingerprint: hash.digest("hex") };
}
```

- [ ] **Step 4: Verify tree behavior**

Run: `npm test -- packages/core/src/tree.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tree.ts packages/core/src/tree.test.ts tests/fixtures
git commit -m "feat(core): inspect and fingerprint Skill trees"
```

### Task 4: Persist versioned state atomically

**Files:**
- Create: `packages/core/src/state-store.ts`
- Test: `packages/core/src/state-store.test.ts`

- [ ] **Step 1: Write tests for missing, valid, and corrupt state**

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { StateStore } from "./state-store.js";

it("creates and reloads schema version 1 state", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "skillport-state-"));
  const store = new StateStore(home);
  await store.save({ schemaVersion: 1, skills: {} });
  expect(await store.load()).toEqual({ schemaVersion: 1, skills: {} });
  expect(JSON.parse(await readFile(path.join(home, "state.json"), "utf8"))).toHaveProperty("schemaVersion", 1);
});

it("rejects corrupt state without replacing it", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "skillport-state-"));
  await writeFile(path.join(home, "state.json"), "{");
  await expect(new StateStore(home).load()).rejects.toThrow("Invalid SkillPort state");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/core/src/state-store.test.ts`

Expected: FAIL because `StateStore` does not exist.

- [ ] **Step 3: Implement Zod schema and atomic save**

Implement `StateStore.load`, `save`, and `withLock` using `mkdir(<home>/.lock)` as the exclusive lock, a unique `state.json.tmp-<pid>-<uuid>` sibling, `fsync`, and `rename`. Parse state with a strict Zod schema matching `ManagedSkill`; reject unsupported schema versions and always release the lock in `finally`.

```ts
export interface SkillPortState { schemaVersion: 1; skills: Record<string, ManagedSkill> }
export class StateStore {
  constructor(readonly root: string) {}
  load(): Promise<SkillPortState>;
  save(state: SkillPortState): Promise<void>;
  withLock<T>(operation: () => Promise<T>): Promise<T>;
}
```

- [ ] **Step 4: Verify state tests**

Run: `npm test -- packages/core/src/state-store.test.ts`

Expected: PASS, including a test proving a second concurrent lock attempt fails with a clear message.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state-store.ts packages/core/src/state-store.test.ts package.json package-lock.json
git commit -m "feat(core): persist SkillPort state atomically"
```

### Task 5: Implement Codex and Claude adapters

**Files:**
- Create: `packages/core/src/agents.ts`
- Test: `packages/core/src/agents.test.ts`

- [ ] **Step 1: Write adapter classification tests**

Create a temporary home containing a normal directory, a link to the canonical Skill, and a link to an unrelated path. Assert the adapter returns `local`, `managed-link`, and `foreign-link` respectively.

```ts
expect(await codex.inspect("pdf", canonical)).toMatchObject({ kind: "managed-link" });
expect(await claude.inspect("other", canonical)).toMatchObject({ kind: "foreign-link" });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/core/src/agents.test.ts`

Expected: FAIL because adapters are missing.

- [ ] **Step 3: Implement adapters**

```ts
export type AgentEntry =
  | { kind: "missing"; path: string }
  | { kind: "local"; path: string; fingerprint: string }
  | { kind: "managed-link"; path: string; target: string }
  | { kind: "foreign-link"; path: string; target: string };

export class AgentAdapter {
  constructor(readonly id: AgentId, readonly root: string) {}
  inspect(name: string, canonical: string): Promise<AgentEntry>;
  installLink(name: string, canonical: string): Promise<void>;
  installCopy(name: string, canonical: string): Promise<void>;
}
```

Normalize resolved link targets before comparison. Never follow a foreign link while hashing or copying.

- [ ] **Step 4: Verify adapters**

Run: `npm test -- packages/core/src/agents.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents.ts packages/core/src/agents.test.ts
git commit -m "feat(core): add Codex and Claude adapters"
```

### Task 6: Plan and execute safe add operations

**Files:**
- Create: `packages/core/src/planner.ts`
- Create: `packages/core/src/executor.ts`
- Create: `packages/core/src/service.ts`
- Test: `packages/core/src/service.add.test.ts`

- [ ] **Step 1: Write add behavior tests**

Cover one-source add, identical copies, differing copies without `from`, explicit source selection, and foreign-link rejection. The conflict test must compare complete before/after directory snapshots to prove no writes occurred.

```ts
const result = await service.add("review");
expect(result).toMatchObject({ kind: "decision-required", choices: ["codex", "claude"] });
expect(await snapshotTree(home)).toEqual(before);
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/core/src/service.add.test.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement operation plans and transaction execution**

Define explicit actions rather than mutating during discovery:

```ts
export type FileAction =
  | { type: "stage-copy"; from: string; staged: string }
  | { type: "backup"; path: string; backup: string }
  | { type: "link"; path: string; target: string }
  | { type: "copy"; path: string; from: string }
  | { type: "save-state"; skill: ManagedSkill };
export interface OperationPlan { id: string; expected: Record<string, string>; actions: FileAction[] }
```

`SkillPortService.add` inspects all candidates, returns a decision result before planning when fingerprints differ, stages the selected source, revalidates expected fingerprints, executes actions, and rolls back backups in reverse order on failure.

- [ ] **Step 4: Verify add transactions**

Run: `npm test -- packages/core/src/service.add.test.ts`

Expected: PASS, including an injected link failure that restores both original Agent directories.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/planner.ts packages/core/src/executor.ts packages/core/src/service.ts packages/core/src/service.add.test.ts
git commit -m "feat(core): safely consolidate local Skills"
```

### Task 7: Add scan, status, diff, sync, and remove

**Files:**
- Create: `packages/core/src/diff.ts`
- Modify: `packages/core/src/service.ts`
- Test: `packages/core/src/service.lifecycle.test.ts`

- [ ] **Step 1: Write lifecycle tests**

Test discovery classification, healthy managed links, missing links, copy drift, bounded text diff, explicit copy synchronization, removal restoration, and failed restoration preserving state and canonical content.

```ts
expect((await service.status("pdf")).overall).toBe("Synced");
await writeFile(path.join(claudeRoot, "pdf", "SKILL.md"), "changed");
expect((await service.status("pdf")).overall).toBe("Local changes");
await service.sync("pdf", "claude");
expect((await service.status("pdf")).overall).toBe("Synced");
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/core/src/service.lifecycle.test.ts`

Expected: FAIL because lifecycle methods are missing.

- [ ] **Step 3: Implement lifecycle methods**

Add these stable facade signatures:

```ts
scan(): Promise<DiscoveredSkill[]>;
list(): Promise<SkillSummary[]>;
status(name?: string): Promise<SkillStatusReport[]>;
diff(name: string): Promise<SkillDiff>;
sync(name: string, source: AgentId | "central"): Promise<OperationResult>;
remove(name: string): Promise<OperationResult>;
```

Limit rendered text diffs to 200 KiB per file and 2,000 output lines. Report larger or binary files by path and fingerprint.

- [ ] **Step 4: Verify lifecycle tests**

Run: `npm test -- packages/core/src/service.lifecycle.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/diff.ts packages/core/src/service.ts packages/core/src/service.lifecycle.test.ts
git commit -m "feat(core): manage the Skill lifecycle"
```

### Task 8: Build the CLI

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/src/format.ts`
- Create: `packages/cli/src/program.ts`
- Create: `packages/cli/src/main.ts`
- Test: `packages/cli/src/program.test.ts`

- [ ] **Step 1: Write command and exit-code tests**

Inject a fake service and output writer. Assert conflict returns exit code `2`, invalid input `3`, unhealthy status `4`, and healthy commands `0`.

```ts
const run = createProgram({ service: fakeConflictService, stdout, stderr });
expect(await run(["node", "skillport", "add", "review"])).toBe(2);
expect(stdout.text()).toContain("skillport add review --from codex");
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/cli/src/program.test.ts`

Expected: FAIL because the CLI package is missing.

- [ ] **Step 3: Implement commands and stable formatting**

Create Commander commands for `scan`, `add`, `diff`, `status`, `sync`, `remove`, and `list`. Keep output rendering in `format.ts`; command handlers only translate service results into renderers and exit codes. Add `bin.skillport = dist/main.js` and a `tsup` build.

```ts
program.command("add").argument("<skill>").option("--from <agent>").action(async (skill, options) => {
  const result = await service.add(skill, options.from);
  exitCode = renderOperation(result, io);
});
```

- [ ] **Step 4: Run CLI tests and a packaged smoke command**

Run: `npm test -- packages/cli/src/program.test.ts && npm run build && node packages/cli/dist/main.js --help`

Expected: tests PASS and help lists all seven implemented commands.

- [ ] **Step 5: Commit**

```bash
git add packages/cli package.json package-lock.json
git commit -m "feat(cli): expose local Skill management commands"
```

## Phase 2: Public GitHub Installation

### Task 9: Download and validate public GitHub Skills

**Files:**
- Create: `packages/core/src/github.ts`
- Modify: `packages/core/src/service.ts`
- Test: `packages/core/src/github.test.ts`
- Modify: `packages/cli/src/program.ts`
- Test: `packages/cli/src/program.install.test.ts`

- [ ] **Step 1: Write installer tests against an injected archive fetcher**

Test repository-root Skill, `--path` Skill, missing `SKILL.md`, path traversal, embedded link, network failure, and collision with a local Skill. Do not call live GitHub in tests.

```ts
const installer = new GitHubInstaller({ fetchArchive: fixtureArchive("multi-skill.tgz") });
const staged = await installer.download({ owner: "acme", repo: "skills", path: "skills/pdf" });
expect((await inspectSkillTree(staged.path)).files).toContain("SKILL.md");
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/core/src/github.test.ts`

Expected: FAIL because `GitHubInstaller` is missing.

- [ ] **Step 3: Implement archive download and selection**

Fetch `https://github.com/<owner>/<repo>/archive/HEAD.tar.gz` with redirect support, a 50 MiB response limit, and a 30-second timeout. Extract with the `tar` library into a unique temporary directory, reject archive links and special entries in the filter, resolve the requested subdirectory, assert containment, then call `inspectSkillTree`.

```ts
export class GitHubInstaller {
  constructor(private readonly deps: { fetchArchive?: ArchiveFetcher } = {}) {}
  download(source: GitHubSource): Promise<{ path: string; cleanup(): Promise<void> }>;
}
```

- [ ] **Step 4: Wire `service.install` and CLI `install`**

```ts
install(url: string, subpath?: string, from?: AgentId): Promise<OperationResult>;
```

The service validates and stages the download, delegates collision handling to the same add planner, records provenance only after commit, and always calls cleanup in `finally`.

- [ ] **Step 5: Verify installer and CLI tests**

Run: `npm test -- packages/core/src/github.test.ts packages/cli/src/program.install.test.ts`

Expected: PASS; network failure fixture leaves the temporary home byte-for-byte unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/core packages/cli package.json package-lock.json
git commit -m "feat: install public GitHub Skills"
```

## Phase 3: Local API and Management Page

### Task 10: Build the protected loopback API

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/start.ts`
- Test: `packages/server/src/app.test.ts`

- [ ] **Step 1: Write API authentication and contract tests**

Use Fastify injection. Assert no token returns `401`, wrong origin returns `403`, reads map service data, mutations return `409` with choices for conflicts, and unexpected errors use a stable error object.

```ts
expect((await app.inject({ method: "GET", url: "/api/skills" })).statusCode).toBe(401);
expect((await authorized(app, "POST", "/api/skills/review/add")).statusCode).toBe(409);
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/server/src/app.test.ts`

Expected: FAIL because the server package is missing.

- [ ] **Step 3: Implement the API**

Create routes for settings, discovery, inventory, detail, diff, add, install, sync, resolve, and remove. Require `x-skillport-token`, validate `Origin` against the generated UI origin, validate bodies with Zod, and map domain errors to stable codes.

```ts
export interface ApiError { code: string; message: string; nextAction?: string }
export function buildApp(options: { service: SkillPortService; token: string; origin: string }): FastifyInstance;
```

- [ ] **Step 4: Implement loopback startup**

`startServer` generates a 32-byte random token, binds explicitly to `127.0.0.1` with port `0`, serves built web assets, and returns the tokenized UI URL. `skillport ui` opens that URL and installs SIGINT/SIGTERM handlers that close the server.

- [ ] **Step 5: Verify server tests**

Run: `npm test -- packages/server/src/app.test.ts`

Expected: PASS, and a startup test asserts the bound address is loopback.

- [ ] **Step 6: Commit**

```bash
git add packages/server packages/cli package.json package-lock.json
git commit -m "feat(server): add protected local management API"
```

### Task 11: Create the React management page

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/api.ts`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/styles.css`
- Create: `packages/web/src/features/skills/SkillsPage.tsx`
- Create: `packages/web/src/features/skills/SkillDetail.tsx`
- Create: `packages/web/src/features/discover/DiscoverPage.tsx`
- Create: `packages/web/src/features/settings/SettingsPage.tsx`
- Test: `packages/web/src/App.test.tsx`

- [ ] **Step 1: Write UI behavior tests**

Mock the typed API client and test the Skills table, health summary, search, detail panel, conflict source buttons, GitHub validation, destructive confirmation, and settings path errors.

```tsx
render(<App api={fakeApi({ skills: [pdfSkill, conflictSkill] })} />);
expect(await screen.findByText("2 Skills · 1 needs attention")).toBeVisible();
await user.click(screen.getByRole("row", { name: /code-review/i }));
expect(screen.getByRole("button", { name: "Use Codex version" })).toBeVisible();
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- packages/web/src/App.test.tsx`

Expected: FAIL because the web package is missing.

- [ ] **Step 3: Implement the typed API client and application shell**

Read the token from the URL fragment, remove it from visible history after initialization, and send it only in `x-skillport-token`. Implement three text-labeled navigation destinations: Skills, Discover, Settings.

- [ ] **Step 4: Implement Skills and detail views**

Render columns for name, provenance, Codex, Claude Code, mode, and status. The detail panel fetches details lazily and exposes explicit buttons: `Use Codex version`, `Use Claude version`, `Use central version`, `Sync`, and `Stop managing`.

- [ ] **Step 5: Implement Discover and GitHub install**

Group scan results by Skill name. Identical copies have one add action; conflicts require a radio source choice. GitHub install validates repository URL and optional path through the API before enabling `Install`.

- [ ] **Step 6: Implement Settings**

Show canonical, Codex, and Claude Code paths plus preferred mode. Disable saving a path change that would orphan managed Skills and render the API's exact migration-required explanation.

- [ ] **Step 7: Verify UI tests and production build**

Run: `npm test -- packages/web/src/App.test.tsx && npm run build -w packages/web`

Expected: PASS and Vite emits `packages/web/dist`.

- [ ] **Step 8: Commit**

```bash
git add packages/web packages/server package.json package-lock.json
git commit -m "feat(web): add the SkillPort management page"
```

### Task 12: Integrate packaging, end-to-end tests, and documentation

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/server/src/start.ts`
- Create: `tests/e2e/skillport.spec.ts`
- Create: `playwright.config.ts`
- Create: `README.md`
- Create: `.gitignore`

- [ ] **Step 1: Write the failing end-to-end flow**

Start SkillPort with an isolated temporary home and fixture GitHub archive provider. In the browser: scan, add a Codex-only Skill, install a GitHub subdirectory Skill, verify both show `Synced`, remove one, and verify restored directories exist.

```ts
test("manages local and GitHub Skills through the UI", async ({ page }) => {
  await page.goto(harness.url);
  await page.getByRole("button", { name: "Scan" }).click();
  await page.getByRole("row", { name: /pdf.*Codex/i }).getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("row", { name: /pdf.*Synced/i })).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E test to verify failure**

Run: `npx playwright test tests/e2e/skillport.spec.ts`

Expected: FAIL until the built web application is served and the harness dependencies are injectable.

- [ ] **Step 3: Finish packaging**

Make the CLI build copy `packages/web/dist` into its distributable assets and start the API from `skillport ui`. Ensure the published package contains the CLI executable, server code, web assets, source maps, README, and license, but excludes tests and fixtures.

- [ ] **Step 4: Write user documentation**

Document requirements, installation, default paths, every command with an example, copy-mode limitations, GitHub safety boundaries, UI startup, recovery behavior, and uninstall instructions. Include a warning that npm/GitHub name availability must be checked before the first public publish.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npx playwright test
npm pack --dry-run -w packages/cli
```

Expected: all checks PASS; the dry-run package includes the executable and web assets and excludes `tests/`.

- [ ] **Step 6: Exercise CLI recovery manually in a temporary home**

Run:

```bash
TEST_HOME="$(mktemp -d)"
HOME="$TEST_HOME" node packages/cli/dist/main.js scan
HOME="$TEST_HOME" node packages/cli/dist/main.js status
```

Expected: both commands exit successfully, report missing Agent directories without creating them, and leave the temporary home unchanged except for no state directory.

- [ ] **Step 7: Commit**

```bash
git add .gitignore README.md playwright.config.ts tests packages/cli packages/server package.json package-lock.json
git commit -m "test: verify and package SkillPort end to end"
```

## Final Acceptance Checklist

- [ ] Existing differing Codex and Claude copies cause no writes without an explicit source.
- [ ] A managed symbolic-link Skill updates immediately from either Agent.
- [ ] Per-Agent link failure falls back to copy mode and `status` reports drift.
- [ ] Removal restores ordinary local directories before deleting canonical state.
- [ ] Public GitHub root and `--path` installs work without executing downloaded content.
- [ ] Unsafe archive entries, links, traversal, oversized downloads, and missing `SKILL.md` are rejected.
- [ ] The API listens only on loopback and rejects missing token or foreign origin requests.
- [ ] CLI and UI expose the same core outcomes and source choices.
- [ ] Typecheck, unit, integration, CLI, API, UI, E2E, and package verification all pass.
