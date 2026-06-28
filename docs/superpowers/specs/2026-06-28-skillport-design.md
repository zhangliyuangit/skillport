# SkillPort Design

## Summary

SkillPort is a local-first Skill manager for developers who use both Codex and Claude Code. It keeps one canonical copy of each managed Skill, links that copy into both Agent directories, detects conflicting existing copies, and exposes the same operations through a CLI and a local browser-based management page.

The first release is intentionally local and single-user. It has no daemon, cloud account, private GitHub authentication, team collaboration, or remote registry.

## Goals

- Maintain one trustworthy local copy of every managed Skill.
- Support Codex at `~/.codex/skills` and Claude Code at `~/.claude/skills`.
- Prefer symbolic links so edits are immediately visible to both Agents.
- Fall back to copy mode when symbolic links are unavailable.
- Never silently choose between conflicting Skill copies.
- Install Skills from public GitHub repositories.
- Provide both a scriptable CLI and a complete local management page.
- Make removal reversible by restoring ordinary Agent-local directories.

## Non-goals

- Background file watching or a persistent daemon.
- Private GitHub repositories or GitHub authentication.
- Automatic updates from GitHub.
- Executing scripts contained in downloaded Skills.
- Windows-specific behavior in the first release.
- Remote access, user accounts, or team collaboration.
- Supporting Agents other than Codex and Claude Code.

## Technology and Repository Structure

SkillPort will be a TypeScript and Node.js monorepo. The working command and package name is `skillport`; npm and GitHub name availability must be checked before public release.

The repository will contain four independently testable units:

- `core`: Agent discovery, Skill inspection, hashing, conflict detection, transactional file operations, and sync orchestration.
- `cli`: command parsing, terminal output, prompts, and exit codes.
- `server`: a loopback-only HTTP API that delegates all operations to `core`.
- `web`: a React single-page management application that calls `server`.

Neither `cli` nor `server` may implement filesystem synchronization directly. Both use the same `core` service interfaces so CLI and web behavior cannot drift.

## Local Data Model

SkillPort stores its data under `~/.skillport` by default:

```text
~/.skillport/
├── skills/             # Canonical Skill directories
└── state.json          # Management metadata
```

`state.json` records:

- schema version;
- each managed Skill's name;
- Agent targets;
- per-Agent synchronization mode (`symlink` or `copy`);
- canonical content fingerprint;
- optional public GitHub repository URL and repository-relative Skill path;
- last successful operation time.

The state file never contains Skill bodies. Writes use a temporary sibling file followed by an atomic rename.

## Agent Adapters

Each Agent adapter exposes a stable interface for:

- returning its default Skill root;
- reporting whether that root exists and is writable;
- locating a named Skill;
- identifying whether the Skill is a directory, a SkillPort link, or an unrelated link;
- installing a link or copy;
- restoring an ordinary local directory.

The first release has two adapters:

| Agent | Default Skill root |
| --- | --- |
| Codex | `~/.codex/skills` |
| Claude Code | `~/.claude/skills` |

Paths are configurable in the local settings page and state configuration, but these defaults are used for discovery.

## Skill Identity and Comparison

A valid Skill is a directory containing a regular `SKILL.md` file. Skill names are derived from the directory name and must be a single safe path segment. Names containing traversal, separators, or reserved dot segments are rejected.

Content equality is based on a deterministic tree fingerprint:

1. Walk regular files in sorted repository-relative path order.
2. Ignore SkillPort's own temporary files and platform metadata such as `.DS_Store`.
3. Hash each relative path, file mode category, and file contents.
4. Hash the ordered entries into one Skill fingerprint.

Symbolic links inside imported Skills are rejected in the first release. This prevents a downloaded or local Skill from escaping its directory during inspection or copying.

## Synchronization Modes

### Symbolic-link mode

Symbolic links are the default. The canonical directory under `~/.skillport/skills/<name>` is the only content copy. Codex and Claude Code entries link to it, so edits from either Agent immediately affect the canonical copy.

### Copy mode

If a particular Agent cannot use symbolic links, only that Agent falls back to copy mode. Copy mode is not continuously synchronized because the first release has no daemon. `status` compares fingerprints and reports drift. The user resolves drift explicitly with `sync --from` or the equivalent web action.

## CLI

The first release exposes:

```text
skillport scan
skillport add <skill> [--from codex|claude]
skillport install <github-url> [--path <subdirectory>]
skillport diff <skill>
skillport status [skill]
skillport sync <skill> --from <codex|claude|central>
skillport remove <skill>
skillport list
skillport ui
```

### `scan`

Discovers Codex and Claude Code Skill directories and groups Skills by name. It classifies each name as present in one Agent, identical across Agents, conflicting, or already managed. It performs no writes.

### `add`

Moves an existing local Skill into canonical management. When only one copy exists, that copy is the source. When all existing copies are identical, any copy may seed the canonical directory. When copies differ, the command stops without modification unless `--from` explicitly selects a source.

### `install`

Installs from a public GitHub HTTPS repository URL. Without `--path`, the repository root must contain `SKILL.md`. With `--path`, the selected repository-relative directory must contain it. The command downloads into a temporary directory, validates the selected tree, and then follows the same collision and linking rules as `add`.

The first release downloads the repository's default branch at its current revision. It records the source URL and selected path for provenance but does not update automatically.

### `diff`

Shows text differences between conflicting copies. Binary or oversized files are reported by path and fingerprint rather than printed.

### `status` and `list`

`list` gives a compact inventory. `status` verifies canonical content, links, copy fingerprints, missing targets, and unmanaged replacements. Output clearly states the next safe command when attention is required.

### `sync`

Used primarily for copy-mode drift. The required `--from` argument prevents an implicit overwrite decision. The source is validated before any destination changes.

### `remove`

Restores ordinary local directories in every configured Agent before deleting management metadata or the canonical copy. If any restoration fails, the canonical copy and state remain intact, and the command reports partial work and recovery instructions.

### `ui`

Starts the local HTTP server on `127.0.0.1` with an available random port and opens the browser. The process remains attached to the terminal and stops when the command exits.

## CLI Output and Exit Behavior

Human-readable output uses consistent status words: `Synced`, `Linked`, `Local changes`, `Conflict`, `Missing`, and `Error`. Destructive or source-selecting operations name the exact source and destination rather than using ambiguous terms such as "overwrite."

Exit codes are stable:

- `0`: operation completed or status is healthy;
- `1`: operational failure;
- `2`: user decision required, such as a conflict;
- `3`: invalid input or configuration;
- `4`: unhealthy status found by `status` without an operational failure.

## GitHub Download Safety

- Only `https://github.com/<owner>/<repository>` URLs are accepted initially.
- Repository and `--path` values are parsed structurally, never concatenated into shell commands.
- Downloads go to a unique temporary directory.
- The resolved selected directory must remain inside the downloaded repository.
- A regular `SKILL.md` is mandatory.
- Symbolic links, sockets, devices, and other special files are rejected.
- Downloaded scripts are treated as files and are never executed.
- Existing local or canonical Skills are never replaced without an explicit source decision.

## Local HTTP API

The server binds only to `127.0.0.1` on an ephemeral port. It accepts requests only from the UI origin created for that process and uses a per-process random token supplied to the opened UI URL and then sent in an API header. This prevents unrelated local web pages from invoking filesystem operations through the loopback API.

The API exposes resource-oriented endpoints for:

- Agent and repository settings;
- discovery results;
- managed Skill inventory and detail;
- diffs;
- add, install, sync, conflict resolution, and removal operations.

Mutations return structured operation results and never interactive prompts. Any required decision is returned as a conflict response for the UI to present explicitly.

## Web Management Page

The React application has three navigation areas:

### Skills

The main table shows Skill name, provenance, Codex state, Claude Code state, synchronization mode, and overall status. Search, scan, and GitHub installation are available from this page.

Selecting a Skill opens a detail panel containing:

- parsed `SKILL.md` metadata and file inventory;
- canonical, Codex, and Claude Code locations and fingerprints;
- text differences when available;
- GitHub source provenance;
- explicit sync, conflict-source selection, and remove actions.

### Discover

Shows unmanaged Skills found in Codex and Claude Code, grouped by name and classified as single-source, identical, or conflicting. Users can add one Skill at a time and must choose a source for conflicts.

It also provides GitHub installation fields for repository URL and optional Skill subdirectory. Validation runs before the install action becomes available.

### Settings

Shows the canonical repository, Codex Skill root, Claude Code Skill root, and the preferred synchronization mode. Path changes are validated and cannot silently orphan already-managed Skills; changing a path with managed Skills requires an explicit migration operation or is rejected in the first release.

## Transaction and Recovery Model

Every mutating operation follows prepare, validate, commit, and cleanup phases:

1. Inspect all sources and destinations and calculate the intended operation plan.
2. Stage canonical or restored content in temporary sibling directories.
3. Revalidate that inspected destinations have not changed.
4. Rename existing entries to operation-specific backups.
5. Put staged entries or links in place.
6. Atomically update state.
7. Remove backups only after the complete operation succeeds.

On failure, SkillPort rolls back from backups. If rollback is incomplete, it retains all recoverable copies and prints their exact paths. Concurrent mutating SkillPort operations are serialized with a lock under `~/.skillport`.

## Error Handling

- Missing Agent directories are warnings during scan and are created only when a user-approved operation needs them.
- Permission errors identify the exact path and leave existing content untouched.
- Unrelated symbolic links are never followed or replaced automatically.
- Invalid or corrupt state blocks mutation but still permits diagnostic status output.
- Network and GitHub failures never change local Skill state.
- UI API errors include a stable machine code, concise message, and optional safe next action.

## Testing Strategy

### Unit tests

- Skill name and GitHub URL validation;
- deterministic directory fingerprints;
- Agent adapter path and link classification;
- conflict classification;
- operation-plan generation;
- state schema parsing and atomic persistence;
- API error mapping.

### Filesystem integration tests

Use isolated temporary home directories to verify:

- adding a Skill from either Agent;
- consolidating identical copies;
- stopping before writes on conflicts;
- explicit conflict-source selection;
- per-Agent symbolic-link fallback to copy mode;
- copy drift detection and explicit sync;
- remove restoration;
- rollback after injected failures;
- rejection of unsafe downloaded trees.

### CLI tests

Run the packaged CLI against temporary homes and assert exit codes plus stable semantic output. Avoid brittle full-screen snapshot assertions.

### Server and UI tests

- API contract tests exercise the server against a fake or temporary-home core service.
- React component tests cover inventory, conflict selection, validation, and confirmation states.
- One browser end-to-end flow covers scan, add, GitHub install through a fixture server, status, and remove.

## Delivery Boundary for Version 1

Version 1 is complete when a user can install SkillPort, consolidate existing Codex and Claude Code Skills without silent loss, install a valid Skill from a public GitHub repository or subdirectory, inspect and resolve status through either CLI or the local management page, and safely return a managed Skill to ordinary Agent-local directories.
