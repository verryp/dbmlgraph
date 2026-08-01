import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbml } from '../src/parse.js';
import { loadOverlays, mergeOverlays } from '../src/overlay.js';
import { exportJsonl } from '../src/export.js';

describe('exportJsonl', () => {
  it('emits one valid JSON line per table with metadata', () => {
    const ir = parseDbml(readFileSync(new URL('./fixtures/small.dbml', import.meta.url), 'utf8'));
    mergeOverlays(ir, loadOverlays(fileURLToPath(new URL('./fixtures/overlays/', import.meta.url))));
    const lines = exportJsonl(ir).trim().split('\n');
    expect(lines).toHaveLength(ir.tables.length);
    const orders = lines.map(l => JSON.parse(l)).find(o => o.id === 'orders');
    expect(orders).toMatchObject({ domain: 'commerce', refs_out: ['users'] });
    expect(orders.text).toContain('# orders');
  });
});
