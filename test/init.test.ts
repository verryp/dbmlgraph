import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseDbml } from '../src/parse.js';
import { loadOverlays, mergeOverlays } from '../src/overlay.js';
import { lint } from '../src/lint.js';
import { init } from '../src/init.js';

const dbml = fileURLToPath(new URL('./fixtures/small.dbml', import.meta.url));

describe('init', () => {
  it('emits a stub per table with blank meanings, enum values listed', () => {
    const out = mkdtempSync(join(tmpdir(), 'dbmlg-init-'));
    const { written, skipped } = init({ input: dbml, outDir: out });

    expect(skipped).toEqual([]);
    expect(written).toContain('orders.yml');
    const orders = parseYaml(readFileSync(join(out, 'orders.yml'), 'utf8'));
    expect(orders.purpose).toBe('');
    // enum column lists every enum value, blank meaning
    expect(orders.columns.status.enum).toEqual({ pending: '', shipped: '', cancelled: '' });
    // non-enum column gets a meaning key
    expect(orders.columns.total).toEqual({ meaning: '' });
    // default-excluded id column is omitted
    expect(orders.columns.id).toBeUndefined();
  });

  it('stubs are structurally valid: parse clean, only W00x warnings', () => {
    const out = mkdtempSync(join(tmpdir(), 'dbmlg-init-'));
    init({ input: dbml, outDir: out });
    const ir = parseDbml(readFileSync(dbml, 'utf8'));
    const issues = mergeOverlays(ir, loadOverlays(out));
    expect(issues).toEqual([]); // no E00x
    expect(lint(ir, issues).errors).toEqual([]);
  });

  it('no-clobber: skips existing overlay files, reports them', () => {
    const out = mkdtempSync(join(tmpdir(), 'dbmlg-init-'));
    writeFileSync(join(out, 'orders.yml'), 'purpose: hand-written\n');
    const { written, skipped } = init({ input: dbml, outDir: out });

    expect(skipped).toContain('orders.yml');
    expect(written).not.toContain('orders.yml');
    // existing file untouched
    expect(readFileSync(join(out, 'orders.yml'), 'utf8')).toBe('purpose: hand-written\n');
  });
});
