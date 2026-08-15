import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveSchemaDir, installClaude, InstallError } from '../src/install.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dbmlgraph-install-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const mkSchemaDir = (rel: string) => {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.dbmlgraph.yml'), 'input: schema.dbml\n');
  return dir;
};

describe('resolveSchemaDir', () => {
  it('explicit --schema-dir wins, validated', () => {
    const dir = mkSchemaDir('schema');
    expect(resolveSchemaDir('schema', root)).toBe(dir);
  });

  it('explicit dir without config throws', () => {
    mkdirSync(join(root, 'empty'));
    expect(() => resolveSchemaDir('empty', root)).toThrow(InstallError);
  });

  it('walks up from cwd to find .dbmlgraph.yml', () => {
    const dir = mkSchemaDir('.');
    const nested = join(root, 'a/b');
    mkdirSync(nested, { recursive: true });
    expect(resolveSchemaDir(undefined, nested)).toBe(dir);
  });

  it('no config anywhere throws with hint', () => {
    const nested = join(root, 'a');
    mkdirSync(nested);
    expect(() => resolveSchemaDir(undefined, nested)).toThrow(/--schema-dir/);
  });
});

describe('installClaude', () => {
  it('writes project skill with baked schema dir', () => {
    const schemaDir = mkSchemaDir('schema');
    const file = installClaude({ schemaDir, cwd: root });
    expect(file).toBe(join(root, '.claude/skills/dbmlgraph/SKILL.md'));
    const content = readFileSync(file, 'utf8');
    expect(content).toMatch(/^---\nname: dbmlgraph\n/);
    expect(content).toContain(schemaDir);
    expect(content).toContain('dbmlgraph find');
    expect(content).toContain('dbmlgraph query');
  });

  it('--global writes under homeDir', () => {
    const schemaDir = mkSchemaDir('schema');
    const home = join(root, 'home');
    const file = installClaude({ schemaDir, cwd: root, global: true, homeDir: home });
    expect(file).toBe(join(home, '.claude/skills/dbmlgraph/SKILL.md'));
    expect(existsSync(file)).toBe(true);
  });

  it('re-install overwrites its own file only', () => {
    const schemaDir = mkSchemaDir('schema');
    installClaude({ schemaDir, cwd: root });
    const other = join(root, '.claude/skills/other/SKILL.md');
    mkdirSync(join(root, '.claude/skills/other'), { recursive: true });
    writeFileSync(other, 'untouched');
    installClaude({ schemaDir: mkSchemaDir('schema2'), cwd: root });
    expect(readFileSync(join(root, '.claude/skills/dbmlgraph/SKILL.md'), 'utf8')).toContain('schema2');
    expect(readFileSync(other, 'utf8')).toBe('untouched');
  });
});
