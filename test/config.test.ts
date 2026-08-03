import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, pick, require_, ConfigFormatError, DEFAULT_CONFIG_FILE } from '../src/config.js';

function writeCfg(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbmlg-cfg-'));
  const path = join(dir, DEFAULT_CONFIG_FILE);
  writeFileSync(path, body);
  return path;
}

describe('config', () => {
  it('loads a valid config', () => {
    const path = writeCfg('input: schema.dbml\noverlays: overlays/\nout: graph/\nlinkStyle: obsidian\n');
    expect(loadConfig(path)).toEqual({ input: 'schema.dbml', overlays: 'overlays/', out: 'graph/', linkStyle: 'obsidian' });
  });

  it('returns {} when the default file is absent (config is optional)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbmlg-none-'));
    const cwd = process.cwd();
    try {
      process.chdir(dir); // no .dbmlgraph.yml here
      expect(loadConfig()).toEqual({});
    } finally {
      process.chdir(cwd);
    }
  });

  it('throws when an explicit --config path is missing', () => {
    expect(() => loadConfig('/nope/.dbmlgraph.yml')).toThrow(ConfigFormatError);
  });

  it('rejects unknown keys and bad linkStyle', () => {
    expect(() => loadConfig(writeCfg('bogus: 1\n'))).toThrow(ConfigFormatError);
    expect(() => loadConfig(writeCfg('linkStyle: html\n'))).toThrow(ConfigFormatError);
  });

  it('pick: flag beats config beats default', () => {
    expect(pick('flag', 'cfg', 'def')).toBe('flag');
    expect(pick(undefined, 'cfg', 'def')).toBe('cfg');
    expect(pick(undefined, undefined, 'def')).toBe('def');
    expect(pick(undefined, undefined)).toBeUndefined();
  });

  it('require_: throws naming the key when unresolved', () => {
    expect(() => require_(undefined, 'input')).toThrow(/missing 'input'/);
    expect(require_('x', 'input')).toBe('x');
  });
});
