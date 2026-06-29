# README Image Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both README hero images load through an accessible GitHub CDN and attribute the implementation commit to the official Codex bot as co-author.

**Architecture:** Preserve the existing README layout and source assets while moving only the image delivery layer from repository-relative raw URLs to jsDelivr's GitHub CDN. The SVG and PNG remain versioned in the repository and are served from the `master` branch CDN path.

**Tech Stack:** Markdown/HTML, jsDelivr GitHub CDN, Git

---

### Task 1: Verify CDN image delivery

**Files:**
- Source: `docs/assets/logo.svg`
- Source: `docs/assets/skills.png`

- [x] **Step 1: Verify both CDN URLs**

Run `curl -sSIL --max-time 30` against both jsDelivr URLs.

Expected: the Logo returns HTTP 200 with `image/svg+xml`; the screenshot returns HTTP 200 with `image/png`.

### Task 2: Replace README image sources

**Files:**
- Modify: `README.md:3`
- Modify: `README.md:18`

- [x] **Step 1: Replace only the two `src` attributes**

Keep the existing HTML, alt text, alignment, and widths. Replace:

```html
<img src="docs/assets/logo.svg" alt="SkillPort" width="300">
<img src="docs/assets/skills.png" alt="SkillPort 管理页面" width="920">
```

with the corresponding `https://cdn.jsdelivr.net/gh/zhangliyuangit/skillport@master/docs/assets/...` URLs.

- [x] **Step 2: Validate the diff**

Run:

```bash
git diff --check
git diff -- README.md
```

Expected: exactly two README image URLs change and there are no whitespace errors.

### Task 3: Verify and publish

**Files:**
- Verify: `README.md`

- [x] **Step 1: Verify both CDN URLs**

Open both URLs and confirm each returns the expected image rather than an error page.

- [x] **Step 2: Run repository checks**

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
git commit -m "docs: serve README images through CDN" -m "Co-authored-by: openai-codex[bot] <177053821+openai-codex[bot]@users.noreply.github.com>"
```

Expected: commit succeeds with the repository owner as primary author and Codex as co-author.

- [ ] **Step 4: Push and verify GitHub rendering**

Run:

```bash
git push origin master
```

Expected: GitHub README renders both images and the commit page lists `openai-codex[bot]` as co-author.
