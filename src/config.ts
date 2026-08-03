import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// Project config. Every field optional — explicit CLI flags override these.
const configSchema = z.object({
  input: z.string().optional(),
  overlays: z.string().optional(),
  out: z.string().optional(),
  linkStyle: z.enum(['obsidian', 'md']).optional(),
  excludeColumns: z.array(z.string()).optional(),
}).strict();

export type Config = z.infer<typeof configSchema>;
export const DEFAULT_CONFIG_FILE = '.dbmlgraph.yml';

export class ConfigFormatError extends Error {}

/**
 * Load config from `path` (default `.dbmlgraph.yml` in cwd).
 * Missing default file → {} (config is optional). Missing explicit path or
 * invalid YAML/shape → ConfigFormatError.
 */
export function loadConfig(path?: string): Config {
  const file = resolve(path ?? DEFAULT_CONFIG_FILE);
  if (!existsSync(file)) {
    if (path) throw new ConfigFormatError(`config file not found: ${path}`);
    return {};
  }
  try {
    return configSchema.parse(parseYaml(readFileSync(file, 'utf8')) ?? {});
  } catch (e: any) {
    throw new ConfigFormatError(`invalid config ${file}: ${e.message}`);
  }
}

/** flag ?? config ?? default — explicit flag wins, then config, then fallback. */
export function pick<T>(flag: T | undefined, cfg: T | undefined, fallback?: T): T | undefined {
  return flag ?? cfg ?? fallback;
}

/** Resolve a required value or throw a CLI-friendly message naming the config key. */
export function require_<T>(value: T | undefined, key: string): T {
  if (value === undefined) {
    throw new ConfigFormatError(`missing '${key}': pass the flag or set it in ${DEFAULT_CONFIG_FILE}`);
  }
  return value;
}
