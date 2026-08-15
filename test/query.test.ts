import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDbml } from '../src/parse.js';
import { query, buildPack, resolveTable, QueryResolveError } from '../src/query.js';

function fixtureIr() {
  return parseDbml(readFileSync(new URL('./fixtures/query.dbml', import.meta.url), 'utf8'));
}

describe('query', () => {
  const ir = fixtureIr();

  it('single table, default flags — fixed skeleton order', () => {
    const md = query(ir, { tables: ['order_items'] });
    expect(md).toMatchSnapshot();
    const order = ['Query: order_items', 'tables: [order_items]', '# order_items', '## Neighbors (depth 1)', '> Complete nodes for order_items'];
    let at = -1;
    for (const marker of order) {
      const i = md.indexOf(marker);
      expect(i, marker).toBeGreaterThan(at);
      at = i;
    }
    expect(md).toContain('1 tables · 3 neighbors · depth 1 · budget 4000');
    expect(md).toContain('- orders → via order_id (many-to-one) — order header');
  });

  it('multi-table pack dedups: queried tables absent from neighbors, shared neighbor once, merged frontmatter', () => {
    const md = query(ir, { tables: ['order_items', 'orders'] });
    const neighborBlock = md.slice(md.indexOf('## Neighbors'), md.indexOf('\n---\n> Complete'));

    // A queried table is never its own neighbor.
    expect(neighborBlock).not.toMatch(/^- order_items /m);
    expect(neighborBlock).not.toMatch(/^- orders /m);
    // promotions is 1 hop from both queried tables — exactly one line, both edges on it.
    expect(neighborBlock.match(/^- promotions /gm)).toHaveLength(1);
    expect(neighborBlock).toContain('promotions → order_items via promo_id (many-to-one); → orders via promo_id (many-to-one)');
    // Two FKs orders → customers collapse with a counted note.
    expect(neighborBlock).toContain('customers → orders via customer_id, billing_customer_id (many-to-one) (2 refs collapsed)');
    // One frontmatter block for the whole pack, not one per table.
    expect(md.match(/^tables: \[/gm)).toHaveLength(1);
    expect(md).toContain('tables: [order_items, orders]');
    expect(md).toContain('domains: [commerce]');
  });

  it('--depth 0 omits the Neighbors section but keeps the queried node', () => {
    const md = query(ir, { tables: ['orders'], depth: 0 });
    expect(md).not.toContain('## Neighbors');
    expect(md).toContain('# orders');
    expect(md).toContain('depth 0');
  });

  it('depth is capped at 2', () => {
    expect(buildPack(ir, { tables: ['order_items'], depth: 9 }).manifest.depth).toBe(2);
  });

  it('--budget tiny: counted truncation label, queried node intact', () => {
    const md = query(ir, { tables: ['orders'], budget: 200 });
    expect(md).toMatch(/… and \d+ more \(raise --budget or --depth\)/);
    // Truncation is never silent and never eats the queried node.
    expect(md).toContain('# orders');
    expect(md).toContain('## Relationships');
  });

  it('--columns all upgrades neighbor entries with a compact column table', () => {
    const md = query(ir, { tables: ['orders'], columns: 'all' });
    expect(md).toContain('| column | type | constraints | role |');
    expect(md).toContain('| user_id | bigint | null | FK |');
    expect(query(ir, { tables: ['orders'] })).not.toContain('| role |');
  });

  it('--format json mirrors the md sections as keys', () => {
    const json = JSON.parse(query(ir, { tables: ['orders'], format: 'json' }));
    expect(Object.keys(json)).toEqual(['manifest', 'tables', 'neighbors', 'rules', 'notExpanded']);
    expect(json.manifest.query).toEqual(['orders']);
    expect(json.tables[0].name).toBe('orders');
    expect(json.neighbors.map((n: any) => n.name)).not.toContain('orders');
    expect(json.notExpanded).toContain('users');
  });

  it('footer lists next-hop tables with a follow-up command, and omits the line when nothing is left', () => {
    expect(query(ir, { tables: ['order_items'] }))
      .toContain('> Not expanded: categories, customers, payments, shipments. Get their nodes: dbmlgraph query categories customers payments shipments');
    // categories/products is a closed pair — depth 1 already covers everything reachable.
    expect(query(ir, { tables: ['categories', 'products', 'order_items'], depth: 1 })).toContain('Not expanded');
    const closed = parseDbml('Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n  a_id int [ref: > a.id]\n}\n');
    expect(query(closed, { tables: ['a'], depth: 1 })).not.toContain('Not expanded');
  });

  it('rules merge across queried tables, deduped, attributed only when >1 table', () => {
    const withRules = fixtureIr();
    withRules.tables.find(t => t.name === 'orders')!.rules = ['Never delete; cancel via status', 'shared rule'];
    withRules.tables.find(t => t.name === 'order_items')!.rules = ['shared rule'];

    const single = query(withRules, { tables: ['orders'] });
    expect(single).toContain('- Never delete; cancel via status');
    expect(single).not.toContain('orders — Never delete');

    const multi = query(withRules, { tables: ['orders', 'order_items'] });
    expect(multi).toContain('- orders — Never delete; cancel via status');
    expect(multi.match(/shared rule/g)).toHaveLength(1);
  });

  describe('name resolution', () => {
    it('accepts an exact name', () => {
      expect(resolveTable(ir, 'orders', false)).toBe('orders');
      expect(resolveTable(ir, 'orders', true)).toBe('orders');
    });

    it('accepts a close match when not strict', () => {
      expect(resolveTable(ir, 'ORDERS', false)).toBe('orders');
      expect(resolveTable(ir, 'order_item', false)).toBe('order_items');
      expect(query(ir, { tables: ['order_item'] })).toContain('Query: order_items');
    });

    it('--strict rejects an inexact match', () => {
      expect(() => resolveTable(ir, 'order_item', true)).toThrow(QueryResolveError);
      expect(() => resolveTable(ir, 'ORDERS', true)).toThrow(QueryResolveError);
    });

    it('a miss reports the top-3 closest names', () => {
      expect(() => resolveTable(ir, 'zzzz', false))
        .toThrow(/No table matched "zzzz"\. Closest: users, orders, payments\./);
    });

    it('an ambiguous near-match is a miss, not a silent pick', () => {
      const amb = parseDbml('Table ab {\n  id int [pk]\n}\nTable ad {\n  id int [pk]\n}\n');
      expect(() => resolveTable(amb, 'ax', false)).toThrow(QueryResolveError);
    });
  });
});
