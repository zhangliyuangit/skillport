# HTTPS Installation Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one verified GitHub Release HTTPS installation command consistently in the README and `v0.1.1` Release notes.

**Architecture:** Documentation remains the only codebase change. The README presents the release URL as the primary installation path and keeps source builds as a developer path; GitHub Release notes mirror the same command. Verification installs the remote tarball into an isolated npm prefix and checks the CLI version.

**Tech Stack:** Markdown, npm, GitHub CLI

---

## File Map

- Modify: `README.md` — user-facing installation, upgrade, uninstall, and source-build instructions.
- Create: `work/release-011-notes-updated.md` — temporary body used to update the existing GitHub Release.

### Task 1: Update README installation guidance

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the installation section**

Use this primary installation command:

```bash
npm install -g "https://github.com/zhangliyuangit/skillport/releases/download/v0.1.1/skillport-0.1.1.tgz"
skillport --version
skillport ui
```

Keep `npm install`, `npm run build`, and `npm link -w packages/cli` under a separate “从源码安装” heading. Add:

```bash
# 升级
npm install -g "https://github.com/zhangliyuangit/skillport/releases/download/v0.1.1/skillport-0.1.1.tgz"

# 卸载
npm uninstall -g skillport
```

- [ ] **Step 2: Check the README command**

Run:

```bash
rg -n "releases/download/v0.1.1/skillport-0.1.1.tgz|从源码安装|npm uninstall -g skillport" README.md
```

Expected: the HTTPS URL, source-install heading, and uninstall command are all present.

- [ ] **Step 3: Commit the README**

```bash
git add README.md
git commit -m "docs: add direct HTTPS installation"
```

### Task 2: Verify the remote package and update GitHub

**Files:**
- Create: `work/release-011-notes-updated.md`

- [ ] **Step 1: Verify the remote install in isolation**

```bash
TEST_DIR=$(mktemp -d)
npm install --prefix "$TEST_DIR" "https://github.com/zhangliyuangit/skillport/releases/download/v0.1.1/skillport-0.1.1.tgz"
"$TEST_DIR/node_modules/.bin/skillport" --version
rm -rf "$TEST_DIR"
```

Expected: `0.1.1`.

- [ ] **Step 2: Update Release notes**

Create `work/release-011-notes-updated.md` by preserving the existing fixes and validation sections, and replace the installation block with:

```bash
npm install -g "https://github.com/zhangliyuangit/skillport/releases/download/v0.1.1/skillport-0.1.1.tgz"
skillport --version
skillport ui
```

Run:

```bash
gh release edit v0.1.1 --repo zhangliyuangit/skillport --notes-file work/release-011-notes-updated.md
```

- [ ] **Step 3: Push README through a PR and verify both surfaces**

```bash
git push -u origin codex/document-http-install
gh pr create --base master --head codex/document-http-install --title "[codex] document direct HTTPS installation" --body-file work/http-install-pr.md
gh pr merge --repo zhangliyuangit/skillport --merge --delete-branch codex/document-http-install
gh release view v0.1.1 --repo zhangliyuangit/skillport --json body,url
```

Expected: the PR is merged and the Release body contains the full HTTPS install URL.
