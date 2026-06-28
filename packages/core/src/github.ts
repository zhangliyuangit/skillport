import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { GitHubSource } from "./domain.js";
import { inspectSkillTree } from "./tree.js";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

export type ArchiveFetcher = (url: string, destination: string) => Promise<void>;

export interface DownloadedSkill {
  path: string;
  cleanup(): Promise<void>;
}

export class GitHubInstaller {
  private readonly fetchArchive: ArchiveFetcher;

  constructor(dependencies: { fetchArchive?: ArchiveFetcher } = {}) {
    this.fetchArchive = dependencies.fetchArchive ?? downloadArchive;
  }

  async download(source: GitHubSource): Promise<DownloadedSkill> {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "skillport-github-"));
    const archive = path.join(temporaryRoot, "repository.tgz");
    const repository = path.join(temporaryRoot, "repository");

    try {
      const url = `https://github.com/${source.owner}/${source.repo}/archive/HEAD.tar.gz`;
      await this.fetchArchive(url, archive);
      await mkdir(repository);
      let unsafeEntry: string | undefined;
      await tar.x({
        cwd: repository,
        file: archive,
        gzip: true,
        strip: 1,
        filter(entryPath, entry) {
          const entryType = "type" in entry ? entry.type : undefined;
          const safeType =
            entryType === "File" ||
            entryType === "OldFile" ||
            entryType === "Directory";
          const unsafePath =
            path.isAbsolute(entryPath) ||
            entryPath.split(/[\\/]/).includes("..");
          if (!safeType || unsafePath) {
            unsafeEntry = entryPath;
            return false;
          }
          return true;
        }
      });
      if (unsafeEntry) throw new Error(`Downloaded Skill contains unsupported archive entry: ${unsafeEntry}`);

      const selected = source.path
        ? path.resolve(repository, source.path)
        : repository;
      const relative = path.relative(repository, selected);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("GitHub Skill path must stay inside the repository");
      }
      await inspectSkillTree(selected);
      return {
        path: selected,
        cleanup: () => rm(temporaryRoot, { recursive: true, force: true })
      };
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }
}

async function downloadArchive(url: string, destination: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`GitHub download failed with HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_ARCHIVE_BYTES) throw new Error("GitHub archive exceeds 50 MiB limit");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("GitHub archive exceeds 50 MiB limit");
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  } finally {
    clearTimeout(timeout);
  }
}
