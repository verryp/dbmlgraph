import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveSchemaDir, installClaude, InstallError, installAgents, uninstall, installStatus, MARKER_START, MARKER_END } from '../src/install.js';

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

describe('installAgents', () => {
  it('creates AGENTS.md when marker section absent', () => {
    const schemaDir = mkSchemaDir('schema');
    const file = installAgents({ schemaDir, cwd: root });
    const content = readFileSync(file, 'utf8');
    expect(content).toContain(MARKER_START);
    expect(content).toContain(MARKER_END);
    expect(content).toContain(schemaDir);
  });

  it('appends section to existing AGENTS.md, preserving user content', () => {
    const schemaDir = mkSchemaDir('schema');
    writeFileSync(join(root, 'AGENTS.md'), '# project\n\nUser rules here.\n');
    installAgents({ schemaDir, cwd: root });
    const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(content).toContain('User rules here.');
    expect(content).toContain(MARKER_START);
  });

  it('re-install replaces existing section instead of duplicating', () => {
    const schemaDir = mkSchemaDir('schema');
    installAgents({ schemaDir, cwd: root });
    installAgents({ schemaDir: mkSchemaDir('schema2'), cwd: root });
    const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(content.split(MARKER_START)).toHaveLength(2);
    expect(content).toContain('schema2');
  });
});

describe('uninstall', () => {
  it('claude: removes project skill dir, returns removed path', () => {
    const schemaDir = mkSchemaDir('schema');
    installClaude({ schemaDir, cwd: root });
    const removed = uninstall('claude', { cwd: root });
    expect(removed).toContain('.claude/skills/dbmlgraph');
    expect(existsSync(join(root, '.claude/skills/dbmlgraph'))).toBe(false);
  });

  it('claude: returns null when nothing installed', () => {
    expect(uninstall('claude', { cwd: root })).toBeNull();
  });

  it('agents: strips marker section, preserving user content', () => {
    const schemaDir = mkSchemaDir('schema');
    writeFileSync(join(root, 'AGENTS.md'), '# Keep me\n');
    installAgents({ schemaDir, cwd: root });
    uninstall('agents', { cwd: root });
    const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(content).toContain('# Keep me');
    expect(content).not.toContain(MARKER_START);
  });

  it('agents: deletes AGENTS.md when section was its only content', () => {
    const schemaDir = mkSchemaDir('schema');
    installAgents({ schemaDir, cwd: root });
    uninstall('agents', { cwd: root });
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
  });
});

describe('installStatus', () => {
  it('reports per-target install state', () => {
    const home = join(root, 'home');
    expect(installStatus({ cwd: root, homeDir: home })).toEqual({ claude: false, claudeGlobal: false, agents: false });
    const schemaDir = mkSchemaDir('schema');
    installClaude({ schemaDir, cwd: root });
    installAgents({ schemaDir, cwd: root });
    expect(installStatus({ cwd: root, homeDir: home })).toEqual({ claude: true, claudeGlobal: false, agents: true });
  });
});
