import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export interface BackupEntry {
  original: string;
  backup: string;
}

export class TransactionJournal {
  readonly backups: BackupEntry[] = [];
  readonly installed = new Set<string>();

  constructor(readonly root: string) {}

  async backup(original: string, label: string): Promise<void> {
    const backup = path.join(this.root, "backups", label);
    await mkdir(path.dirname(backup), { recursive: true });
    await rename(original, backup);
    this.backups.push({ original, backup });
  }

  markInstalled(installedPath: string): void {
    this.installed.add(installedPath);
  }

  async rollback(canonical: string): Promise<void> {
    for (const installedPath of [...this.installed].reverse()) {
      await rm(installedPath, { recursive: true, force: true });
    }
    await rm(canonical, { recursive: true, force: true });
    for (const entry of [...this.backups].reverse()) {
      await mkdir(path.dirname(entry.original), { recursive: true });
      await rename(entry.backup, entry.original);
    }
    await rm(this.root, { recursive: true, force: true });
  }

  async commit(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}
