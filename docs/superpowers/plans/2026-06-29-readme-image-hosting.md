# README Image Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both README hero images load through GitHub user attachments and attribute the implementation commit to the official Codex bot as co-author.

**Architecture:** Preserve the existing README layout while moving only the image delivery layer from repository-relative raw URLs to immutable GitHub attachment URLs. Render the SVG logo to PNG before upload so both assets use GitHub's standard image attachment path.

**Tech Stack:** Markdown/HTML, macOS Quick Look image rendering, GitHub web UI, Git

---

### Task 1: Prepare and upload image assets

**Files:**
- Source: `docs/assets/logo.svg`
- Source: `docs/assets/skills.png`
- Create temporarily: `/tmp/skillport-readme-assets/logo.svg.png`

- [ ] **Step 1: Render the SVG logo as PNG**

Run:

```bash
mkdir -p /tmp/skillport-readme-assets
qlmanage -t -s 600 -o /tmp/skillport-readme-assets docs/assets/logo.svg
```

Expected: `/tmp/skillport-readme-assets/logo.svg.png` is created as a valid PNG.

- [ ] **Step 2: Verify both upload inputs**

Run:

```bash
file /tmp/skillport-readme-assets/logo.svg.png docs/assets/skills.png
```

Expected: both files are reported as PNG images.

- [ ] **Step 3: Upload both images through the logged-in GitHub issue editor**

Open a new issue draft for `zhangliyuangit/skillport`, attach both PNG files, wait for both `github.com/user-attachments/assets/...` URLs to appear, and copy the URLs without submitting the issue.

### Task 2: Replace README image sources

**Files:**
- Modify: `README.md:3`
- Modify: `README.md:18`

- [ ] **Step 1: Replace only the two `src` attributes**

Keep the existing HTML, alt text, alignment, and widths. Replace:

```html
<img src="docs/assets/logo.svg" alt="SkillPort" width="300">
<img src="docs/assets/skills.png" alt="SkillPort 管理页面" width="920">
```

with the two attachment URLs returned by GitHub.

- [ ] **Step 2: Validate the diff**

Run:

```bash
git diff --check
git diff -- README.md
```

Expected: exactly two README image URLs change and there are no whitespace errors.

### Task 3: Verify and publish

**Files:**
- Verify: `README.md`

- [ ] **Step 1: Verify both attachment URLs**

Open both URLs and confirm each returns the expected image rather than an error page.

- [ ] **Step 2: Run repository checks**

Run:

```bash
npm run typecheck
npm test
```

Expected: typecheck succeeds and all tests pass.

- [ ] **Step 3: Commit with Codex co-author attribution**

Run:

```bash
git add README.md docs/superpowers/plans/2026-06-29-readme-image-hosting.md
git commit -m "docs: host README images on GitHub attachments" -m "Co-authored-by: openai-codex[bot] <177053821+openai-codex[bot]@users.noreply.github.com>"
```

Expected: commit succeeds with the repository owner as primary author and Codex as co-author.

- [ ] **Step 4: Push and verify GitHub rendering**

Run:

```bash
git push origin master
```

Expected: GitHub README renders both images and the commit page lists `openai-codex[bot]` as co-author.

