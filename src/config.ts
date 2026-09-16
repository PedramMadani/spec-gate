import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { parse } from 'yaml';
import type { GateConfig, ProfileRule } from './types.js';

export const CONFIG_NAME = '.spec-gate.yml';

export class ConfigError extends Error {}

/** Walk up from `from` looking for .spec-gate.yml. The config belongs to the repo,
 *  not to the caller: this is what stops an agent choosing a softer profile for
 *  itself. A caller can pick the working directory, not the rules. */
export function findConfig(from = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    const candidate = resolve(dir, CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(from = process.cwd()): GateConfig {
  const source = findConfig(from);
  if (!source) throw new ConfigError(`no ${CONFIG_NAME} found from ${resolve(from)} upwards`);

  let raw: unknown;
  try {
    raw = parse(readFileSync(source, 'utf8'));
  } catch (e) {
    throw new ConfigError(`${source} is not valid YAML: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object') throw new ConfigError(`${source} is empty`);
  const c = raw as Record<string, unknown>;

  const defaultProfile = typeof c.profile === 'string' ? c.profile : 'agent-task';
  const rules = Array.isArray(c.rules) ? c.rules.map((r, i) => rule(r, `${source} rule ${i}`)) : [];
  const recordsDir = typeof c.records === 'string' ? c.records : '.spec-gate';

  let thresholdOverride: number | undefined;
  if (c.threshold !== undefined) {
    if (typeof c.threshold !== 'number' || c.threshold <= 0 || c.threshold > 1)
      throw new ConfigError(`${source}: threshold must be a number in (0, 1]`);
    thresholdOverride = c.threshold;
  }

  return { root: dirname(source), source, defaultProfile, rules, recordsDir, thresholdOverride };
}

function rule(raw: unknown, where: string): ProfileRule {
  if (!raw || typeof raw !== 'object') throw new ConfigError(`${where}: not an object`);
  const r = raw as Record<string, unknown>;
  if (typeof r.profile !== 'string' || !r.profile.trim())
    throw new ConfigError(`${where}: "profile" must be a non-empty string`);
  const paths = Array.isArray(r.paths) ? r.paths.filter((p): p is string => typeof p === 'string') : [];
  return { paths, profile: r.profile };
}

/** Longest matching prefix wins, so a specific rule beats a general one regardless
 *  of the order they appear in the file. Paths outside the repo fall back to the
 *  default profile rather than silently passing ungated. */
export function profileFor(config: GateConfig, target?: string): string {
  if (!target) return config.defaultProfile;
  const rel = normalise(relative(config.root, resolve(config.root, target)));
  let best: { len: number; profile: string } | null = null;
  for (const r of config.rules) {
    for (const p of r.paths) {
      const prefix = normalise(p);
      if (rel === prefix || rel.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
        if (!best || prefix.length > best.len) best = { len: prefix.length, profile: r.profile };
      }
    }
  }
  return best?.profile ?? config.defaultProfile;
}

const normalise = (p: string): string => p.split(sep).join('/').replace(/^\.\//, '').replace(/\/+$/, '');
