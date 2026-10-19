import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { DependencyType } from '../types.js';

export interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LockPackage {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  devOptional?: boolean;
  peer?: boolean;
  link?: boolean;
}

export interface Lockfile {
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readPackageJson(cwd: string): Promise<PackageJson> {
  const path = join(cwd, 'package.json');
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PackageJson;
  } catch (err) {
    throw new Error(`Could not read ${path}: ${(err as Error).message}`);
  }
}

export async function readLockfile(cwd: string): Promise<Lockfile | undefined> {
  const path = join(cwd, 'package-lock.json');
  if (!(await fileExists(path))) return undefined;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Lockfile;
  } catch {
    return undefined;
  }
}

/** Writes package.json while preserving the original indentation and trailing newline. */
export async function updatePackageJson(cwd: string, mutate: (pkg: PackageJson) => void): Promise<void> {
  const path = join(cwd, 'package.json');
  const raw = await readFile(path, 'utf8');
  const indent = /^([ \t]+)"/m.exec(raw)?.[1] ?? '  ';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const pkg = JSON.parse(raw) as PackageJson;
  mutate(pkg);
  let out = JSON.stringify(pkg, null, indent);
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  await writeFile(path, out + (raw.endsWith('\n') ? eol : ''), 'utf8');
}

export function getDependencyType(pkg: PackageJson, name: string): DependencyType | undefined {
  if (pkg.dependencies?.[name] !== undefined) return 'prod';
  if (pkg.optionalDependencies?.[name] !== undefined) return 'optional';
  if (pkg.devDependencies?.[name] !== undefined) return 'dev';
  if (pkg.peerDependencies?.[name] !== undefined) return 'peer';
  return undefined;
}

export function getDeclaredSpec(pkg: PackageJson, name: string): string | undefined {
  return (
    pkg.dependencies?.[name] ??
    pkg.optionalDependencies?.[name] ??
    pkg.devDependencies?.[name] ??
    pkg.peerDependencies?.[name]
  );
}

/** Returns the package name for a lockfile node path, e.g. `node_modules/a/node_modules/@s/b` -> `@s/b`. */
export function nodePathToName(nodePath: string): string {
  const idx = nodePath.lastIndexOf('node_modules/');
  return idx === -1 ? nodePath : nodePath.slice(idx + 'node_modules/'.length);
}
