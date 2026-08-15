import type { IR } from './ir.js';
import { columnConstraints } from './render/table.js';
import { editDistance } from './query.js';

export type FindKind = 'table' | 'column' | 'enum' | 'enum_value' | 'domain';
export type MatchLevel = 'exact' | 'glob' | 'fuzzy';

export interface FindHit {
  kind: FindKind;
  match: MatchLevel;
  name: string;              // the matched identifier itself
  table?: string;            // column hits: owning table
  type?: string;             // column hits
  constraints?: string;      // column hits, incl. `FK → target`
  meaning?: string;          // overlay meaning, untruncated (renderer truncates for md)
  enum?: string;             // enum_value hits from a DBML enum: the enum name
  usedBy?: string[];         // enum / enum_value: `table.column`; domain: member tables
  domain?: string;           // table hits: domain slug
}

interface IndexEntry { key: string; hit: FindHit }

export function buildFindIndex(ir: IR): IndexEntry[] {
  const entries: IndexEntry[] = [];

  // enum name -> table.column users
  const enumUsers = new Map<string, string[]>();
  for (const t of ir.tables) for (const c of t.columns) {
    if (!c.enumName) continue;
    const arr = enumUsers.get(c.enumName) ?? [];
    arr.push(`${t.name}.${c.name}`);
    enumUsers.set(c.enumName, arr);
  }

  // table -> column -> FK target tables
  const fkOf = new Map<string, Map<string, string[]>>();
  for (const r of ir.refs) {
    const m = fkOf.get(r.fromTable) ?? new Map<string, string[]>();
    for (const c of r.fromColumns) {
      const arr = m.get(c) ?? [];
      if (!arr.includes(r.toTable)) arr.push(r.toTable);
      m.set(c, arr);
    }
    fkOf.set(r.fromTable, m);
  }

  for (const t of ir.tables) {
    entries.push({ key: t.name, hit: { kind: 'table', match: 'exact', name: t.name, domain: t.domain } });
    for (const c of t.columns) {
      const fk = fkOf.get(t.name)?.get(c.name);
      const constraints = [columnConstraints(c), fk ? `FK → ${fk.join('/')}` : null]
        .filter(Boolean).join(', ');
      entries.push({ key: c.name, hit: {
        kind: 'column', match: 'exact', name: c.name, table: t.name,
        type: c.type, constraints, meaning: c.meaning ?? undefined,
      }});
      if (c.valueSet) for (const v of c.valueSet.values) {
        entries.push({ key: v.value, hit: {
          kind: 'enum_value', match: 'exact', name: v.value,
          usedBy: [`${t.name}.${c.name}`], meaning: v.meaning || undefined,
        }});
      }
    }
  }

  for (const e of ir.enums) {
    entries.push({ key: e.name, hit: { kind: 'enum', match: 'exact', name: e.name, usedBy: enumUsers.get(e.name) ?? [] } });
    for (const v of e.values) {
      entries.push({ key: v.name, hit: {
        kind: 'enum_value', match: 'exact', name: v.name, enum: e.name,
        usedBy: enumUsers.get(e.name) ?? [], meaning: v.meaning ?? undefined,
      }});
    }
  }

  for (const d of ir.domains) {
    entries.push({ key: d.slug, hit: { kind: 'domain', match: 'exact', name: d.slug, usedBy: [...d.tables] } });
  }

  return entries;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Merge hits that describe the same node (same kind+name+table+enum), unioning usedBy. */
function dedupe(hits: FindHit[]): FindHit[] {
  const byKey = new Map<string, FindHit>();
  for (const h of hits) {
    const key = `${h.kind}|${h.name}|${h.table ?? ''}|${h.enum ?? ''}`;
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, { ...h, usedBy: h.usedBy ? [...h.usedBy] : undefined }); continue; }
    if (h.usedBy) cur.usedBy = [...new Set([...(cur.usedBy ?? []), ...h.usedBy])];
  }
  return [...byKey.values()];
}

/**
 * Exact (incl. case-insensitive) wins; a term containing `*` is a glob;
 * fuzzy (edit distance <= 2) only runs when exact found nothing and not strict.
 */
export function findHits(ir: IR, term: string, strict: boolean): FindHit[] {
  const entries = buildFindIndex(ir);

  if (term.includes('*')) {
    const re = new RegExp(`^${term.split('*').map(escapeRe).join('.*')}$`, 'i');
    return dedupe(entries.filter(e => re.test(e.key)).map(e => ({ ...e.hit, match: 'glob' as const })));
  }

  const exact = entries.filter(e => e.key === term);
  if (exact.length) return dedupe(exact.map(e => e.hit));

  const ci = entries.filter(e => e.key.toLowerCase() === term.toLowerCase());
  if (ci.length) return dedupe(ci.map(e => ({ ...e.hit, match: 'exact' as const })));

  if (strict) return [];

  const fuzzy = entries.filter(e => editDistance(term.toLowerCase(), e.key.toLowerCase()) <= 2);
  return dedupe(fuzzy.map(e => ({ ...e.hit, match: 'fuzzy' as const })));
}

/** Top-n closest identifier names, for the no-match suggestion line. */
export function closestIdentifiers(ir: IR, term: string, n: number): string[] {
  const keys = [...new Set(buildFindIndex(ir).map(e => e.key))];
  return keys
    .map(k => ({ k, d: editDistance(term.toLowerCase(), k.toLowerCase()) }))
    .sort((a, b) => a.d - b.d || a.k.localeCompare(b.k))
    .slice(0, n)
    .map(x => x.k);
}

export interface FindOptions {
  terms: string[];
  format?: 'md' | 'json';
  strict?: boolean;
}

const MEANING_MAX = 120;
const clip = (s: string | undefined) =>
  s && s.length > MEANING_MAX ? s.slice(0, MEANING_MAX - 3) + '…' : (s ?? '');

const KIND_ORDER: { kind: FindKind; title: string }[] = [
  { kind: 'column', title: 'Column matches' },
  { kind: 'table', title: 'Table matches' },
  { kind: 'enum', title: 'Enum matches' },
  { kind: 'enum_value', title: 'Enum value matches' },
  { kind: 'domain', title: 'Domain matches' },
];

function renderTermMd(ir: IR, term: string, hits: FindHit[], strict: boolean): string {
  const L: string[] = [];
  if (!hits.length) {
    L.push(`no matches for "${term}"`);
    if (!strict) L.push(`closest: ${closestIdentifiers(ir, term, 3).join(', ')}`);
    return L.join('\n');
  }
  const fuzzy = hits.every(h => h.match === 'fuzzy');
  L.push(`find: ${term} · ${hits.length} hit${hits.length === 1 ? '' : 's'}${fuzzy ? ' (fuzzy)' : ''}`);
  for (const { kind, title } of KIND_ORDER) {
    const group = hits.filter(h => h.kind === kind);
    if (!group.length) continue;   // empty kinds omitted entirely
    L.push('');
    L.push(`## ${title}`);
    if (kind === 'column') {
      L.push('| table | column | type | constraints | meaning |');
      L.push('| --- | --- | --- | --- | --- |');
      for (const h of [...group].sort((a, b) => a.table!.localeCompare(b.table!))) {
        L.push(`| ${h.table} | ${h.name} | ${h.type} | ${h.constraints} | ${clip(h.meaning)} |`);
      }
    } else if (kind === 'table') {
      for (const h of group) {
        L.push(`- ${h.name} (domain: ${h.domain}) — run \`dbmlgraph query ${h.name}\` for full context`);
      }
    } else if (kind === 'enum') {
      for (const h of group) L.push(`- enum ${h.name} — used by: ${(h.usedBy ?? []).join(', ') || '(unused)'}`);
    } else if (kind === 'enum_value') {
      for (const h of group) {
        const where = h.enum ? `in ${h.enum}` : 'in value-set';
        const meaning = h.meaning ? ` — ${clip(h.meaning)}` : '';
        L.push(`- ${h.name} ${where} — used by: ${(h.usedBy ?? []).join(', ')}${meaning}`);
      }
    } else {
      for (const h of group) L.push(`- ${h.name} — ${(h.usedBy ?? []).length} tables`);
    }
  }
  return L.join('\n');
}

/** buildIndex + match + render in the caller's format. Pure; the CLI just prints. */
export function find(ir: IR, opts: FindOptions): string {
  const strict = opts.strict ?? false;
  const perTerm = opts.terms.map(term => ({ term, hits: findHits(ir, term, strict) }));

  if (opts.format === 'json') {
    const flat = perTerm.flatMap(({ term, hits }) => hits.map(h => ({ term, ...h })));
    return JSON.stringify(flat, null, 2);
  }
  return perTerm.map(({ term, hits }) => renderTermMd(ir, term, hits, strict)).join('\n\n---\n\n');
}
