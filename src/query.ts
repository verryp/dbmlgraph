import type { IR, TableNode, Ref } from './ir.js';
import { renderTableBody, columnConstraints } from './render/table.js';

export const MAX_DEPTH = 2;
export const DEFAULT_DEPTH = 1;
export const DEFAULT_BUDGET = 4000;

export interface QueryOptions {
  tables: string[];
  depth?: number;          // neighbor hops, clamped to 0..MAX_DEPTH
  budget?: number;         // approx tokens (chars/4) for the whole pack
  columns?: 'key' | 'all'; // column detail for NEIGHBOR summaries only
  format?: 'md' | 'json';
  strict?: boolean;        // exact names only, no fuzzy accept
}

/** Thrown when an argument resolves to no table (or ambiguously). Carries the
 *  suggestion line so the CLI can print it verbatim and exit 1. */
export class QueryResolveError extends Error {}

export interface NeighborEdge {
  from: string;            // the pack-side table this edge attaches to
  arrow: '→' | '←';        // direction relative to the queried pack
  columns: string;
  kind: Ref['kind'];
}

export interface NeighborPack {
  name: string;
  domain: string;
  hook: string;
  depth: number;
  edges: NeighborEdge[];
  columns?: { name: string; type: string; constraints: string; role: string }[];
}

export interface QueryPack {
  manifest: { query: string[]; tableCount: number; neighborCount: number; depth: number; budget: number };
  tables: { name: string; domain: string; body: string }[];
  neighbors: NeighborPack[];
  neighborsTruncated: number;
  rules: { table: string; rule: string }[];
  notExpanded: string[];
  domains: string[];
}

/** Levenshtein distance, iterative two-row. Only used for short table names. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Exact match wins. Without `strict`, a case-insensitive match or a single
 * candidate within edit distance 2 is accepted silently. Anything else throws
 * with the top-3 closest names.
 */
export function resolveTable(ir: IR, arg: string, strict: boolean): string {
  const exact = ir.tables.find(t => t.name === arg);
  if (exact) return exact.name;

  const closest = ir.tables
    .map(t => ({ name: t.name, d: editDistance(arg.toLowerCase(), t.name.toLowerCase()) }))
    .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name));

  if (!strict) {
    const ci = ir.tables.filter(t => t.name.toLowerCase() === arg.toLowerCase());
    if (ci.length === 1) return ci[0].name;
    const near = closest.filter(c => c.d <= 2);
    if (near.length === 1) return near[0].name;
  }
  throw new QueryResolveError(`No table matched "${arg}". Closest: ${closest.slice(0, 3).map(c => c.name).join(', ')}.`);
}

/** FK degree — every ref touching the table, both directions. */
function fkDegree(ir: IR, name: string): number {
  return ir.refs.filter(r => r.fromTable === name || r.toTable === name).length;
}

/** The other end of a ref relative to `name`, or null when it doesn't touch it. */
function otherEnd(r: Ref, name: string): { table: string; outbound: boolean } | null {
  if (r.fromTable === name && r.toTable !== name) return { table: r.toTable, outbound: true };
  if (r.toTable === name && r.fromTable !== name) return { table: r.fromTable, outbound: false };
  return null;
}

const hookOf = (t: TableNode): string => (t.purpose ?? t.note ?? '').replace(/\n+/g, ' ').trim();

/** PK / FK / enum-or-valueSet columns — the `--columns key` subset. */
function keyColumns(ir: IR, t: TableNode) {
  const fkCols = new Set(ir.refs.filter(r => r.fromTable === t.name).flatMap(r => r.fromColumns));
  return t.columns
    .filter(c => c.pk || fkCols.has(c.name) || c.enumName || c.valueSet)
    .map(c => ({
      name: c.name,
      type: c.type,
      constraints: columnConstraints(c),
      role: [c.pk && 'PK', fkCols.has(c.name) && 'FK', (c.enumName || c.valueSet) && 'enum'].filter(Boolean).join('/'),
    }));
}

const approxTokens = (s: string): number => Math.ceil(s.length / 4);

/**
 * Build the context pack. Pure: takes a merged IR plus resolved options and
 * returns the pack — no I/O, no process exit. This is the future MCP tool body.
 */
export function buildPack(ir: IR, opts: QueryOptions): QueryPack {
  const depth = Math.min(Math.max(opts.depth ?? DEFAULT_DEPTH, 0), MAX_DEPTH);
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const columns = opts.columns ?? 'key';
  const strict = opts.strict ?? false;

  const queried: string[] = [];
  for (const arg of opts.tables) {
    const name = resolveTable(ir, arg, strict);
    if (!queried.includes(name)) queried.push(name);
  }
  const queriedSet = new Set(queried);

  // BFS from the queried set. A table that is itself queried is never a neighbor,
  // and a neighbor reached from several queried tables collapses into one entry.
  const seen = new Set(queried);
  const neighbors = new Map<string, NeighborPack>();
  const notExpanded = new Set<string>();
  let frontier = queried;
  for (let hop = 1; hop <= depth + 1; hop++) {
    const next: string[] = [];
    for (const from of frontier) {
      for (const r of ir.refs) {
        const end = otherEnd(r, from);
        if (!end || queriedSet.has(end.table)) continue;
        if (hop > depth) { notExpanded.add(end.table); continue; }
        let n = neighbors.get(end.table);
        if (!n) {
          const t = ir.tables.find(t => t.name === end.table)!;
          n = { name: t.name, domain: t.domain, hook: hookOf(t), depth: hop, edges: [] };
          if (columns === 'all') n.columns = keyColumns(ir, t);
          neighbors.set(end.table, n);
        }
        // Arrow is relative to the pack: `→` = the pack-side table points out to
        // the neighbor, `←` = the neighbor points back into the pack.
        n.edges.push({ from, arrow: end.outbound ? '→' : '←', columns: r.fromColumns.join(', '), kind: r.kind });
        if (!seen.has(end.table)) { seen.add(end.table); next.push(end.table); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  // Anything already included as a neighbor is expanded, not pending.
  for (const name of neighbors.keys()) notExpanded.delete(name);

  // Rank: edge distance asc, FK-degree desc, name asc. Rank order is also the
  // print order, so the cut always removes from the tail.
  const ranked = [...neighbors.values()].sort((a, b) =>
    a.depth - b.depth || fkDegree(ir, b.name) - fkDegree(ir, a.name) || a.name.localeCompare(b.name));

  const tables = queried.map(name => {
    const t = ir.tables.find(t => t.name === name)!;
    return { name, domain: t.domain, body: renderTableBody(t, ir, 'md', { rules: false }) };
  });

  // Rules merged across queried tables, deduped by text (first table wins).
  const rules: { table: string; rule: string }[] = [];
  const seenRules = new Set<string>();
  for (const name of queried) {
    for (const rule of ir.tables.find(t => t.name === name)!.rules) {
      if (seenRules.has(rule)) continue;
      seenRules.add(rule);
      rules.push({ table: name, rule });
    }
  }

  const domains = [...new Set(queried.map(n => ir.tables.find(t => t.name === n)!.domain))];

  // Rank-then-cut: queried nodes are never cut, so only the neighbor tail moves.
  // Measure with the real renderer so the cut reflects what actually prints.
  const pack: QueryPack = {
    manifest: { query: queried, tableCount: queried.length, neighborCount: ranked.length, depth, budget },
    tables, neighbors: ranked, neighborsTruncated: 0, rules,
    notExpanded: [...notExpanded].sort(), domains,
  };
  while (pack.neighbors.length && approxTokens(renderPack(pack, columns)) > budget) {
    pack.neighbors = pack.neighbors.slice(0, -1);
    pack.neighborsTruncated++;
  }
  pack.manifest.neighborCount = pack.neighbors.length;
  return pack;
}

/**
 * Repeated edges between the same table pair collapse into one fragment carrying
 * a `(N refs collapsed)` note — two FKs from orders to customers print once.
 */
function collapseEdges(edges: NeighborEdge[], attribute: boolean): string {
  const byPair = new Map<string, { edge: NeighborEdge; cols: string[]; count: number }>();
  for (const e of edges) {
    const key = `${e.arrow}${e.from}${e.kind}`;
    const hit = byPair.get(key);
    if (hit) { hit.count++; if (!hit.cols.includes(e.columns)) hit.cols.push(e.columns); }
    else byPair.set(key, { edge: e, cols: [e.columns], count: 1 });
  }
  // With one queried table the pack-side name is implied; with several, naming it
  // is what shows a neighbor connecting to more than one of them.
  return [...byPair.values()]
    .map(p => `${p.edge.arrow}${attribute ? ` ${p.edge.from}` : ''} via ${p.cols.join(', ')} (${p.edge.kind})${p.count > 1 ? ` (${p.count} refs collapsed)` : ''}`)
    .join('; ');
}

export function renderPack(pack: QueryPack, columns: 'key' | 'all' = 'key'): string {
  const { manifest } = pack;
  const L: string[] = [];

  L.push(`Query: ${manifest.query.join(', ')} · ${manifest.tableCount} tables · ${manifest.neighborCount} neighbors · depth ${manifest.depth} · budget ${manifest.budget}`);
  L.push('---');
  L.push(`tables: [${manifest.query.join(', ')}]`);
  L.push(`domains: [${pack.domains.join(', ')}]`);
  L.push('---');
  L.push('');

  for (const t of pack.tables) {
    L.push(t.body);
    L.push('');
  }

  if (manifest.depth > 0) {
    L.push(`## Neighbors (depth ${manifest.depth})`);
    for (const n of pack.neighbors) {
      L.push(`- ${n.name} ${collapseEdges(n.edges, manifest.tableCount > 1)}${n.hook ? ` — ${n.hook}` : ''}`);
      if (columns === 'all' && n.columns?.length) {
        L.push('');
        L.push('  | column | type | constraints | role |');
        L.push('  | --- | --- | --- | --- |');
        for (const c of n.columns) L.push(`  | ${c.name} | ${c.type} | ${c.constraints} | ${c.role} |`);
        L.push('');
      }
    }
    if (pack.neighborsTruncated) L.push(`… and ${pack.neighborsTruncated} more (raise --budget or --depth)`);
    L.push('');
  }

  if (pack.rules.length) {
    L.push('## Rules');
    // Attribute the rule to its table only when the pack spans several tables.
    const attribute = manifest.tableCount > 1;
    for (const r of pack.rules) L.push(`- ${attribute ? `${r.table} — ` : ''}${r.rule}`);
    L.push('');
  }

  L.push('---');
  L.push(`> Complete nodes for ${manifest.query.join(', ')} are above — do not open tables/*.md for them.`);
  if (pack.notExpanded.length) {
    L.push(`> Not expanded: ${pack.notExpanded.join(', ')}. Get their nodes: dbmlgraph query ${pack.notExpanded.join(' ')}`);
  }
  return L.join('\n');
}

/** JSON mirror of the md sections — same keys, same content, no extra model. */
export function packToJson(pack: QueryPack) {
  return {
    manifest: pack.manifest,
    tables: pack.tables,
    neighbors: pack.neighbors.map(n => ({ ...n, edges: collapseEdges(n.edges, pack.manifest.tableCount > 1) })),
    rules: pack.rules,
    notExpanded: pack.notExpanded,
  };
}

/** buildPack + render in the caller's format. Pure; the CLI just prints the result. */
export function query(ir: IR, opts: QueryOptions): string {
  const pack = buildPack(ir, opts);
  return opts.format === 'json'
    ? JSON.stringify(packToJson(pack), null, 2)
    : renderPack(pack, opts.columns ?? 'key');
}
