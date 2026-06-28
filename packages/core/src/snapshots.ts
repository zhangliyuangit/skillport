import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SnapshotInfo {
  id: string;
  createdAt: string;
  label?: string;
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(() => true).catch(() => false);
}

/**
 * Point-in-time backups of the central Skill content and managed state, kept
 * under `<root>/snapshots/<id>`. Used as an undo safety net before destructive
 * operations and for explicit restore.
 */
export class SnapshotStore {
  constructor(
    readonly root: string,
    private readonly now: () => Date = () => new Date(),
    private readonly retain = 25
  ) {}

  private dir(): string {
    return path.join(this.root, "snapshots");
  }

  async create(label?: string): Promise<SnapshotInfo> {
    const id = this.now().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(this.dir(), id);
    await mkdir(destination, { recursive: true });

    const stateFile = path.join(this.root, "state.json");
    if (await exists(stateFile)) await cp(stateFile, path.join(destination, "state.json"));
    const skills = path.join(this.root, "skills");
    if (await exists(skills)) {
      await cp(skills, path.join(destination, "skills"), {
        recursive: true,
        dereference: false
      });
    }

    const info: SnapshotInfo = { id, createdAt: id, ...(label ? { label } : {}) };
    await writeFile(
      path.join(destination, "snapshot.json"),
      `${JSON.stringify(info, null, 2)}\n`,
      "utf8"
    );
    await this.prune();
    return info;
  }

  async list(): Promise<SnapshotInfo[]> {
    const entries = await readdir(this.dir(), { withFileTypes: true }).catch(() => []);
    const infos: SnapshotInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await readFile(
        path.join(this.dir(), entry.name, "snapshot.json"),
        "utf8"
      ).catch(() => undefined);
      infos.push(meta ? (JSON.parse(meta) as SnapshotInfo) : { id: entry.name, createdAt: entry.name });
    }
    return infos.sort((a, b) => b.id.localeCompare(a.id));
  }

  pathFor(id: string): string {
    return path.join(this.dir(), id);
  }

  async exists(id: string): Promise<boolean> {
    return exists(this.pathFor(id));
  }

  private async prune(): Promise<void> {
    const all = await this.list();
    for (const snapshot of all.slice(this.retain)) {
      await rm(this.pathFor(snapshot.id), { recursive: true, force: true });
    }
  }
}
