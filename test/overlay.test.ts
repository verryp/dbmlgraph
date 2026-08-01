import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbml } from '../src/parse.js';
import { loadOverlays, mergeOverlays } from '../src/overlay.js';

const src = readFileSync(new URL('./fixtures/small.dbml', import.meta.url), 'utf8');
const dir = fileURLToPath(new URL('./fixtures/overlays/', import.meta.url));

describe('overlay', () => {
  it('merges purpose, rules, column semantics, enum meanings', () => {
    const ir = parseDbml(src);
    const issues = mergeOverlays(ir, loadOverlays(dir));
    expect(issues).toEqual([]);
    const orders = ir.tables.find(t => t.name === 'orders')!;
    expect(orders.purpose).toContain('Order header');
    expect(orders.rules).toHaveLength(1);
    expect(orders.columns.find(c => c.name === 'total')!.formula).toContain('SUM');
    const e = ir.enums.find(e => e.name === 'order_status')!;
    expect(e.values.find(v => v.name === 'shipped')!.meaning).toBe('handed to courier');
  });

  it('reports drift instead of silently skipping', () => {
    const ir = parseDbml(src);
    const overlays = loadOverlays(dir);
    overlays.set('ghost_table', { purpose: 'x', rules: [], columns: {} });
    overlays.get('users')!.columns['no_such_col'] = { meaning: 'x' };
    const issues = mergeOverlays(ir, overlays);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'E001', table: 'ghost_table' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'E002', table: 'users' }));
  });

  it('E003 on unknown enum value', () => {
    const ir = parseDbml(src);
    const overlays = loadOverlays(dir);
    overlays.get('orders')!.columns['status']!.enum!['refunded'] = 'x';
    const issues = mergeOverlays(ir, overlays);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'E003', table: 'orders' }));
  });
});
