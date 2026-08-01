import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
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
});
