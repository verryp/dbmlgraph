import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/generate.js';

const fixture = fileURLToPath(new URL('./fixtures/small.dbml', import.meta.url));
const overlays = fileURLToPath(new URL('./fixtures/overlays/', import.meta.url));

describe('generate', () => {
  it('writes index + tables/ + domains/ tree', () => {
    const out = mkdtempSync(join(tmpdir(), 'dbmlgraph-'));
    const res = generate({ input: fixture, overlaysDir: overlays, outDir: out, linkStyle: 'md' });
    expect(existsSync(join(out, '_index.md'))).toBe(true);
    expect(existsSync(join(out, 'tables', 'orders.md'))).toBe(true);
    expect(existsSync(join(out, 'domains', 'commerce.md'))).toBe(true);
    expect(res.issues).toEqual([]);
    expect(readFileSync(join(out, '_index.md'), 'utf8')).toContain('audit_log');
  });

  it('refuses to write outside outDir for a path-traversal table name', () => {
    const out = mkdtempSync(join(tmpdir(), 'dbmlgraph-'));
    const maliciousDbml = join(out, 'malicious.dbml');
    writeFileSync(maliciousDbml, 'Table "../../../../tmp/pwned" {\n  id int [pk]\n}\n');
    expect(() => generate({ input: maliciousDbml, outDir: out, linkStyle: 'md' })).toThrow(/pwned/);
    expect(existsSync('/tmp/pwned.md')).toBe(false);
  });

  it('writes AGENTS.md into the output dir root with interpolated stats', () => {
    const out = mkdtempSync(join(tmpdir(), 'dbmlgraph-'));
    generate({ input: fixture, overlaysDir: overlays, outDir: out, linkStyle: 'md' });
    const agentsPath = join(out, 'AGENTS.md');
    expect(existsSync(agentsPath)).toBe(true);
    const md = readFileSync(agentsPath, 'utf8');
    expect(md).toContain('4 tables · 3 domains');
    expect(md).toContain('identity');
    expect(md).toContain('Commerce');
  });

  it('overwrites an existing AGENTS.md', () => {
    const out = mkdtempSync(join(tmpdir(), 'dbmlgraph-'));
    writeFileSync(join(out, 'AGENTS.md'), 'stale content from a previous run');
    generate({ input: fixture, overlaysDir: overlays, outDir: out, linkStyle: 'md' });
    const md = readFileSync(join(out, 'AGENTS.md'), 'utf8');
    expect(md).not.toContain('stale content from a previous run');
    expect(md).toContain('# AGENTS.md');
  });
});
