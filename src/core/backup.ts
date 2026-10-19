import { mkdir, readFile, writeFile, readdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists } from './project.js';

export const STATE_DIR = '.audit-sherpa';
const BACKUP_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'];
const MAX_BACKUPS = 10;

function backupsRoot(cwd: string): string {
  return join(cwd, STATE_DIR, 'backups');
}

/** Copies package.json + lockfile into `.audit-sherpa/backups/<timestamp>` and returns that directory. */
export async function createBackup(cwd: string): Promise<string> {
  const stateDir = join(cwd, STATE_DIR);
  await mkdir(stateDir, { recursive: true });
  // keep the state directory out of version control without touching the user's .gitignore
  const gitignore = join(stateDir, '.gitignore');
  if (!(await fileExists(gitignore))) await writeFile(gitignore, '*\n', 'utf8');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(backupsRoot(cwd), stamp);
  await mkdir(dir, { recursive: true });
  for (const f of BACKUP_FILES) {
    if (await fileExists(join(cwd, f))) await copyFile(join(cwd, f), join(dir, f));
  }
  await pruneBackups(cwd);
  return dir;
}

export async function listBackups(cwd: string): Promise<string[]> {
  const root = backupsRoot(cwd);
  if (!(await fileExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((n) => join(root, n));
}

/** Restores package.json + lockfile from the given (or latest) backup. Returns the backup dir used. */
export async function restoreBackup(cwd: string, dir?: string): Promise<string> {
  const target = dir ?? (await listBackups(cwd)).at(-1);
  if (!target || !(await fileExists(target))) throw new Error('No audit-sherpa backup found to restore.');
  for (const f of BACKUP_FILES) {
    const src = join(target, f);
    if (await fileExists(src)) await copyFile(src, join(cwd, f));
  }
  return target;
}

async function pruneBackups(cwd: string): Promise<void> {
  const all = await listBackups(cwd);
  for (const old of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) {
    await rm(old, { recursive: true, force: true });
  }
}

export type Snapshot = Map<string, string | null>;

/** In-memory snapshot used to revert a single failed fix action. */
export async function takeSnapshot(cwd: string): Promise<Snapshot> {
  const snap: Snapshot = new Map();
  for (const f of BACKUP_FILES) {
    const p = join(cwd, f);
    snap.set(f, (await fileExists(p)) ? await readFile(p, 'utf8') : null);
  }
  return snap;
}

export async function restoreSnapshot(cwd: string, snap: Snapshot): Promise<void> {
  for (const [f, content] of snap) {
    const p = join(cwd, f);
    if (content === null) await rm(p, { force: true });
    else await writeFile(p, content, 'utf8');
  }
}
