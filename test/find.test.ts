import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbml } from '../src/parse.js';
import { loadOverlays, mergeOverlays } from '../src/overlay.js';
import { findHits, find } from '../src/find.js';

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

describe('find — rendering', () => {
  const ir = fixtureIr();

  it('md: grouped by kind, header count, table pointer line', () => {
    const md = find(ir, { terms: ['cycle_id'] });
    expect(md).toContain('find: cycle_id ·');
    expect(md).toContain('## Column matches');
    expect(md).toContain('| orders | cycle_id | bigint |');
    expect(md).toContain('Owning planning cycle');
    expect(md).not.toContain('## Table matches');   // empty kinds omitted when others matched
  });

  it('md: table hit renders pointer to query', () => {
    const md = find(ir, { terms: ['orders'] });
    expect(md).toContain('run `dbmlgraph query orders` for full context');
  });

  it('md: enum value hit', () => {
    const md = find(ir, { terms: ['PHYSICAL'] });
    expect(md).toContain('PHYSICAL in item_type_enum');
    expect(md).toContain('used by: order_items.item_type');
  });

  it('md: no matches prints suggestions', () => {
    const md = find(ir, { terms: ['zzzzzz'] });
    expect(md).toContain('no matches for "zzzzzz"');
    expect(md).toMatch(/closest: /i);
  });

  it('md: no matches with --strict has no suggestions', () => {
    const md = find(ir, { terms: ['zzzzzz'], strict: true });
    expect(md).toContain('no matches for "zzzzzz"');
    expect(md).not.toMatch(/closest: /i);
  });

  it('md: meaning truncated at ~120 chars', () => {
    const longIr = fixtureIr();
    const col = longIr.tables.find(t => t.name === 'orders')!.columns.find(c => c.name === 'cycle_id')!;
    col.meaning = 'x'.repeat(200);
    const md = find(longIr, { terms: ['cycle_id'] });
    expect(md).toContain('x'.repeat(117) + '…');
    expect(md).not.toContain('x'.repeat(121));
  });

  it('json: array of hits with term field, meaning untruncated', () => {
    const longIr = fixtureIr();
    longIr.tables.find(t => t.name === 'orders')!.columns.find(c => c.name === 'cycle_id')!.meaning = 'x'.repeat(200);
    const out = JSON.parse(find(longIr, { terms: ['cycle_id'], format: 'json' }));
    expect(Array.isArray(out)).toBe(true);
    expect(out[0].term).toBe('cycle_id');
    const orders = out.find((h: any) => h.table === 'orders');
    expect(orders.meaning).toHaveLength(200);
  });

  it('multi-term: one section per term (md), flat array with term field (json)', () => {
    const md = find(ir, { terms: ['orders', 'PHYSICAL'] });
    expect(md).toContain('find: orders ·');
    expect(md).toContain('find: PHYSICAL ·');
    const out = JSON.parse(find(ir, { terms: ['orders', 'PHYSICAL'], format: 'json' }));
    expect(new Set(out.map((h: any) => h.term))).toEqual(new Set(['orders', 'PHYSICAL']));
  });
});
