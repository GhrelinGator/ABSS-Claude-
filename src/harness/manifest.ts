// Facts recorded next to every run so it can be reproduced: which code,
// which machine, which engine.

import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { cpus } from 'node:os';

export interface RepoInfo {
  /** Commit hash of the code that ran, or null outside a git checkout. */
  readonly commit: string | null;
  /** True if there were uncommitted changes, which makes the commit hash an incomplete description. */
  readonly dirty: boolean | null;
}

export function getRepoInfo(cwd: string): RepoInfo {
  try {
    const options: ExecFileSyncOptionsWithStringEncoding = {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    };
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
    const status = execFileSync('git', ['status', '--porcelain'], options).trim();
    return { commit, dirty: status.length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

export interface MachineInfo {
  readonly node: string;
  readonly v8: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpu: string;
  readonly cores: number;
}

export function getMachineInfo(): MachineInfo {
  const processors = cpus();
  return {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu: processors.length > 0 ? processors[0].model : 'unknown',
    cores: processors.length,
  };
}
