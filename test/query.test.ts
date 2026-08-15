import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDbml } from '../src/parse.js';
import { query, buildPack, renderPack, resolveTable, QueryResolveError } from '../src/query.js';

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
    expect(md).toContain('1 tables · 3 neighbors · depth 1 · budget auto');
    expect(md).toContain('- orders → via order_id (many-to-one) — order header');
  });

  it('neighbors carry their own key columns by default — PK, FK targets, enum types', () => {
    const md = query(ir, { tables: ['order_items'] });
    // A solver joining THROUGH orders needs orders' key names, not just the hook line.
    expect(md).toContain('  keys: id (PK) · customer_id → customers · billing_customer_id → customers · promo_id → promotions');
    expect(md).toContain('  keys: id (PK) · category_id → categories');
    // Enum-typed columns carry their type name so the value domain is nameable.
    expect(query(ir, { tables: ['orders'] })).toContain('  keys: id (PK) · order_id → orders · status: shipment_status');
    // Every neighbor gets a key line, and no queried table's own body grows one.
    expect(md.match(/^ {2}keys: /gm)).toHaveLength(3);
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

  // A hub with `spokes` inbound refs, each spoke carrying `fks` outbound FKs so its
  // rendered `keys:` line is wide. At the defaults the pack needs ~5.8k tokens, so a
  // flat 4000 cap degrades roughly half the neighbors. Generated rather than checked
  // in: what matters is the shape (one hub, n wide direct partners, a depth-2 tail),
  // not the names, and a fixture this size would be ~20KB of DBML in the repo.
  function hubIr(spokes = 50, fks = 12) {
    const lookups = Array.from({ length: fks }, (_, c) => `
Table lookup_${c} {
  id bigint [pk]
  name varchar(80)
}`).join('\n');
    const spokeTables = Array.from({ length: spokes }, (_, i) => {
      const refs = Array.from({ length: fks }, (_, c) => `  ref_${c}_id bigint [ref: > lookup_${c}.id]`).join('\n');
      return `
Table spoke_${i} {
  id bigint [pk]
  accounts_id bigint [not null, ref: > accounts.id]
${refs}
  Note: 'spoke ${i} — a direct FK partner of the hub, wide on purpose'
}`;
    }).join('\n');
    return parseDbml(`
Table accounts {
  id bigint [pk]
  Note: 'the hub every spoke points at'
}
${lookups}
${spokeTables}
`);
  }

  it('default budget is adaptive — a hub keeps every depth-1 neighbor in full form', () => {
    const hub = hubIr();
    // The flat 4000 cap is what the adaptive default replaces: it degrades everything.
    const flat = buildPack(hub, { tables: ['accounts'], budget: 4000 });
    expect(flat.neighborsDegraded).toBeGreaterThan(0);

    const auto = buildPack(hub, { tables: ['accounts'] });
    expect(auto.neighbors).toHaveLength(50);
    expect(auto.neighborsDegraded).toBe(0);
    expect(auto.neighborsTruncated).toBe(0);
    expect(auto.budgetExceeded).toBe(false);
    expect(auto.manifest.budgetAuto).toBe(true);
    expect(auto.manifest.budget).toBeGreaterThan(4000);

    const md = renderPack(auto);
    for (const n of auto.neighbors) expect(md, n.name).toContain(`- ${n.name} ←`);
    // Every neighbor keeps its key line, and no degradation/truncation note is printed.
    expect(md.match(/^ {2}keys: /gm) ?? []).toHaveLength(50);
    expect(md).not.toContain('without key columns');
    expect(md).not.toContain('budget exceeded');
    expect(md).not.toContain('… and');
    expect(md).toContain('· budget auto');
  });

  it('adaptive budget still ranks and cuts depth-2, and never dips below the floor', () => {
    const auto = buildPack(hubIr(), { tables: ['accounts'], depth: 2 });
    // Depth 1 is guaranteed room, so the whole cut lands on the depth-2 tail —
    // adaptive is not "no budget", it is a floor under the direct relationships.
    expect(auto.neighbors.filter(n => n.depth === 1)).toHaveLength(50);
    expect(auto.neighbors.filter(n => n.depth === 1).every(n => !n.degraded)).toBe(true);
    expect(auto.neighborsTruncated).toBeGreaterThan(0);
    expect(auto.neighborsDegraded).toBeGreaterThan(0);
    expect(auto.neighbors.filter(n => n.degraded).every(n => n.depth === 2)).toBe(true);
    expect(auto.budgetExceeded).toBe(false);

    // A small schema does not inflate: it stays at the floor.
    expect(buildPack(ir, { tables: ['order_items'] }).manifest.budget).toBe(4000);
  });

  it('an explicit --budget opts back into the hard cap, adaptive flag off', () => {
    const hub = hubIr();
    const explicit = buildPack(hub, { tables: ['accounts'], budget: 4000 });
    expect(explicit.manifest.budgetAuto).toBe(false);
    expect(explicit.manifest.budget).toBe(4000);
    expect(renderPack(explicit)).toContain('· budget 4000');
    // Same pack on the adaptive default is strictly better off.
    expect(explicit.neighborsDegraded).toBeGreaterThan(buildPack(hub, { tables: ['accounts'] }).neighborsDegraded);
  });

  it('--format json exposes resolvedBudget alongside the "auto" label', () => {
    const auto = JSON.parse(query(hubIr(), { tables: ['accounts'], format: 'json' }));
    expect(auto.manifest.budget).toBe('auto');
    expect(auto.manifest.budgetAuto).toBe(true);
    expect(auto.manifest.resolvedBudget).toBeGreaterThan(4000);

    const explicit = JSON.parse(query(ir, { tables: ['orders'], budget: 4000, format: 'json' }));
    expect(explicit.manifest.budget).toBe(4000);
    expect(explicit.manifest.budgetAuto).toBe(false);
    expect(explicit.manifest.resolvedBudget).toBe(4000);
  });

  it('--budget tiny: counted truncation label, queried node intact', () => {
    const md = query(ir, { tables: ['order_items'], depth: 2, budget: 300 });
    expect(md).toMatch(/… and \d+ more \(raise --budget or --depth\)/);
    // Truncation is never silent and never eats the queried node.
    expect(md).toContain('# order_items');
    expect(md).toContain('## Relationships');
  });

  it('budget pressure degrades neighbors to bare summaries before dropping any', () => {
    const opts = { tables: ['order_items'] as string[], depth: 2 };
    const roomy = buildPack(ir, { ...opts, budget: 4000 });
    // 330 is the band where key lines no longer fit but every entry still does.
    const tight = buildPack(ir, { ...opts, budget: 330 });

    expect(tight.neighbors).toHaveLength(roomy.neighbors.length);
    expect(tight.neighborsTruncated).toBe(0);
    expect(tight.neighborsDegraded).toBe(roomy.neighbors.length);
    expect(tight.neighbors.every(n => n.degraded)).toBe(true);

    const md = renderPack(tight);
    expect(md).toContain(`(${roomy.neighbors.length} neighbors shown without key columns — raise --budget)`);
    expect(md).not.toContain('  keys: ');
    expect(md).not.toContain('… and');
  });

  it('dropping only resumes once every neighbor is already degraded', () => {
    // 300 forces a drop; anything still present must have given up its keys first.
    const p = buildPack(ir, { tables: ['order_items'], depth: 2, budget: 300 });
    expect(p.neighborsTruncated).toBeGreaterThan(0);
    expect(p.neighbors.every(n => n.degraded)).toBe(true);
    expect(p.neighborsDegraded).toBe(p.neighbors.length);  // dropped entries stop counting
  });

  it('depth-1 FK partners survive an extreme budget, degraded, with an exceeded note', () => {
    const p = buildPack(ir, { tables: ['order_items'], depth: 2, budget: 40 });
    // Hiding a direct FK partner would produce confidently-wrong SQL — oversize instead.
    expect(p.neighbors.map(n => n.name)).toEqual(['orders', 'products', 'promotions']);
    expect(p.neighbors.every(n => n.directFk && n.degraded)).toBe(true);
    expect(p.budgetExceeded).toBe(true);

    const md = renderPack(p);
    expect(md).toContain('(budget exceeded to preserve direct relationships)');
    expect(md).toContain('- orders → via order_id (many-to-one)');
    // Depth-2-only neighbors are the ones that went.
    expect(md).not.toContain('- categories ');
  });

  it('--columns all upgrades neighbor entries with a compact column table', () => {
    const md = query(ir, { tables: ['orders'], columns: 'all' });
    expect(md).toContain('| column | type | constraints | role |');
    expect(md).toContain('| user_id | bigint | null | FK |');
    // The compact key line belongs to the `key` view only — `all` already has the table.
    expect(md).not.toContain('  keys: ');
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

  it('--format json carries neighbor keys and the degradation flags', () => {
    const json = JSON.parse(query(ir, { tables: ['orders'], format: 'json' }));
    const shipments = json.neighbors.find((n: any) => n.name === 'shipments');
    expect(shipments.keys).toEqual([
      { name: 'id', pk: true, fkTargets: [], enum: null },
      { name: 'order_id', pk: false, fkTargets: ['orders'], enum: null },
      { name: 'status', pk: false, fkTargets: [], enum: 'shipment_status' },
    ]);
    expect(shipments.directFk).toBe(true);
    expect(shipments.degraded).toBe(false);
    expect(json.manifest).toMatchObject({ neighborsTruncated: 0, neighborsDegraded: 0, budgetExceeded: false });

    const tight = JSON.parse(query(ir, { tables: ['order_items'], depth: 2, budget: 40, format: 'json' }));
    expect(tight.manifest.budgetExceeded).toBe(true);
    expect(tight.neighbors.every((n: any) => n.degraded)).toBe(true);
    // keys stay in the json even when the md view degrades — json has no width problem.
    expect(tight.neighbors[0].keys.length).toBeGreaterThan(0);
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
