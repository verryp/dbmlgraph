import { Parser } from '@dbml/core';
import type { IR, Domain, TableNode, Column, EnumDef, Ref, IndexDef } from './ir.js';

export class DbmlParseError extends Error {}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const BANNER_RE = /^\/\/\s*DOMAIN\s+\d+\s*:\s*(.+?)\s*$/;

/** raw-text pre-scan: banner line number → domain name (parser drops comments) */
function scanBanners(source: string): { line: number; name: string }[] {
  return source.split('\n').flatMap((text, i) => {
    const m = text.match(BANNER_RE);
    return m ? [{ line: i + 1, name: m[1] }] : [];
  });
}

export function parseDbml(source: string): IR {
  let db;
  try {
    db = Parser.parse(source, 'dbmlv2');
  } catch (e: any) {
    // @dbml/core throws CompilerError with .diags[{location:{start:{line}}, message}]
    const diag = e?.diags?.[0];
    const where = diag?.location?.start?.line ? ` (line ${diag.location.start.line})` : '';
    throw new DbmlParseError(`DBML parse failed${where}: ${diag?.message ?? e.message}`);
  }
  const s = db.schemas[0];
  const enumNames = new Set<string>(s.enums.map((e: any) => e.name));

  const enums: EnumDef[] = s.enums.map((e: any) => ({
    name: e.name,
    values: e.values.map((v: any) => ({ name: v.name, note: v.note ?? null, meaning: null })),
  }));

  // domain resolution
  const groupOf = new Map<string, string>(); // tableName → domain name
  for (const g of s.tableGroups) for (const t of g.tables) groupOf.set(t.name, g.name);
  const banners = scanBanners(source);
  const domainNameOf = (t: any): string => {
    if (groupOf.has(t.name)) return groupOf.get(t.name)!;
    const tableLine = t.token?.start?.line ?? 0;
    const before = banners.filter(b => b.line < tableLine).at(-1);
    return before?.name ?? 'ungrouped';
  };

  const domainNames = new Map<string, string>(); // slug → raw domain name, first occurrence wins
  const tables: TableNode[] = s.tables.map((t: any) => {
    const rawDomain = domainNameOf(t);
    const slug = slugify(rawDomain);
    if (!domainNames.has(slug)) domainNames.set(slug, rawDomain === 'ungrouped' ? 'Ungrouped' : rawDomain);
    return {
    name: t.name,
    domain: slug,
    note: t.note ?? null,
    purpose: null,
    rules: [],
    columns: t.fields.map((f: any): Column => ({
      name: f.name,
      // type_name already includes args rendered, e.g. 'varchar(100)' — args is just the raw '100'
      type: f.type.type_name,
      pk: !!f.pk,
      notNull: !!f.not_null,
      unique: !!f.unique,
      increment: !!f.increment,
      default: f.dbdefault?.value != null ? String(f.dbdefault.value) : null,
      note: f.note ?? null,
      enumName: enumNames.has(f.type.type_name) ? f.type.type_name : null,
      meaning: null, generated: null, formula: null,
    })),
    indexes: t.indexes.map((i: any): IndexDef => ({
      name: i.name ?? null,
      columns: i.columns.map((c: any) => String(c.value)),
      unique: !!i.unique,
      note: i.note ?? null,
    })),
    };
  });

  // domains ordered by first table appearance; names resolved once in the tables pass above
  const domains: Domain[] = [];
  for (const t of tables) {
    let d = domains.find(d => d.slug === t.domain);
    if (!d) {
      d = { slug: t.domain, name: domainNames.get(t.domain)!, tables: [] };
      domains.push(d);
    }
    d.tables.push(t.name);
  }
  for (const d of domains) d.tables.sort();

  const refs: Ref[] = s.refs.map((r: any) => {
    // endpoint with relation '1' is the parent (to-side)
    const [a, b] = r.endpoints;
    const parent = a.relation === '1' ? a : b;
    const child = parent === a ? b : a;
    const kind: Ref['kind'] =
      a.relation === '1' && b.relation === '1' ? 'one-to-one'
      : a.relation === '*' && b.relation === '*' ? 'many-to-many'
      : 'many-to-one';
    return {
      fromTable: child.tableName, fromColumns: [...child.fieldNames],
      toTable: parent.tableName, toColumns: [...parent.fieldNames], kind,
    };
  });

  return { databaseName: s.name === 'public' ? null : s.name ?? null, domains, tables, enums, refs };
}
