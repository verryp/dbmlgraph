import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbml } from '../src/parse.js';
import { loadOverlays, mergeOverlays } from '../src/overlay.js';
import { findHits } from '../src/find.js';

function fixtureIr(withOverlays = true) {
  const ir = parseDbml(readFileSync(new URL('./fixtures/find.dbml', import.meta.url), 'utf8'));
  if (withOverlays) {
    mergeOverlays(ir, loadOverlays(fileURLToPath(new URL('./fixtures/find-overlays', import.meta.url))));
  }
  return ir;
}

describe('findHits — matching', () => {
  const ir = fixtureIr();

  it('column exact match across tables, with FK constraint and overlay meaning', () => {
    const hits = findHits(ir, 'cycle_id', false);
    const cols = hits.filter(h => h.kind === 'column');
    expect(cols.map(c => c.table).sort()).toEqual(['order_items', 'orders']);
    const orders = cols.find(c => c.table === 'orders')!;
    expect(orders.match).toBe('exact');
    expect(orders.type).toBe('bigint');
    expect(orders.constraints).toContain('FK → cycles');
    expect(orders.meaning).toBe('Owning planning cycle');
  });

  it('table exact match', () => {
    const hits = findHits(ir, 'orders', false);
    const t = hits.find(h => h.kind === 'table');
    expect(t).toMatchObject({ name: 'orders', match: 'exact' });
  });

  it('enum name match carries usedBy', () => {
    const hits = findHits(ir, 'item_type_enum', false);
    const e = hits.find(h => h.kind === 'enum')!;
    expect(e.usedBy).toEqual(['order_items.item_type']);
  });

  it('DBML enum value match', () => {
    const hits = findHits(ir, 'PHYSICAL', false);
    const v = hits.find(h => h.kind === 'enum_value')!;
    expect(v.enum).toBe('item_type_enum');
    expect(v.usedBy).toEqual(['order_items.item_type']);
  });

  it('overlay value-set value matches as enum_value (the KICKOFF case)', () => {
    const hits = findHits(ir, 'ACTIVE', false);
    const v = hits.find(h => h.kind === 'enum_value')!;
    expect(v.enum).toBeUndefined();
    expect(v.usedBy).toEqual(['orders.status']);
    expect(v.meaning).toBe('input window open');
  });

  it('glob match', () => {
    const hits = findHits(ir, 'cycle_*', false);
    expect(hits.every(h => h.match === 'glob')).toBe(true);
    // cycle_id exists in two tables (orders, order_items) and dedupe keys on
    // (kind,name,table), so 3 hits survive even though only 2 distinct names match.
    expect([...new Set(hits.map(h => h.name))].sort()).toEqual(['cycle_code', 'cycle_id']);
    expect(hits).toHaveLength(3);
  });

  it('fuzzy only when no exact/glob hit', () => {
    const hits = findHits(ir, 'cycl_id', false);   // distance 1 from cycle_id
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.match === 'fuzzy')).toBe(true);
  });

  it('strict disables fuzzy', () => {
    expect(findHits(ir, 'cycl_id', true)).toEqual([]);
  });

  it('case-insensitive exact accepted, labeled exact', () => {
    const hits = findHits(ir, 'ORDERS', false);
    expect(hits.find(h => h.kind === 'table')!.match).toBe('exact');
  });

  it('same value in multiple places merges usedBy into one hit', () => {
    // status ACTIVE only lives on orders.status in this fixture — assert single hit, not duplicates
    const hits = findHits(ir, 'ACTIVE', false).filter(h => h.kind === 'enum_value');
    expect(hits).toHaveLength(1);
  });
});
