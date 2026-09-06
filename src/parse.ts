import { readFileSync } from 'node:fs';
import { Parser } from '@dbml/core';
import type { IR, Domain, TableNode, Column, EnumDef, Ref, IndexDef } from './ir.js';

export class DbmlParseError extends Error {
  /** 1-based source line, when @dbml/core reports one. */
  line: number | null = null;
  /** Underlying diagnostic message, without the "DBML parse failed..." prefix — for CLI formatting. */
  detail: string;
  /** Set by parseDbmlFile — the input path that failed to parse. */
  file: string | null = null;
  /** Set by parseDbmlFile — true when the input looked like markdown but no ```dbml fence was found. */
  markdownNoFence = false;

  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;
// A block "looks like DBML" if any line inside it opens with a top-level DBML keyword.
const DBML_LOOKS_LIKE_RE = /^(Table|Enum|Project)\s/m;

function extractFences(content: string): { lang: string; body: string }[] {
  const re = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
  const out: { lang: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push({ lang: m[1].trim().toLowerCase(), body: m[2] });
  return out;
}

/**
 * Real-world DBML often lives embedded in a Markdown note (Obsidian vault, docs) as
 * a fenced code block. Extraction heuristic, in order:
 *  1. Any ```dbml fence(s), case-insensitive — concatenate all of them. Checked
 *     unconditionally (regardless of extension) since it's an explicit, unambiguous signal.
 *  2. Else, only for .md/.markdown files that look like a markdown document (start with
 *     `---` frontmatter or a `#` heading): fall back to generic ``` fences whose body
 *     looks like DBML (a line starting with `Table `, `Enum `, or `Project `) and
 *     concatenate those.
 *  3. Otherwise return the content unchanged — plain .dbml files never hit fence scanning.
 */
export function extractDbmlSource(content: string, isMarkdownExt: boolean): { source: string; extractedFromFence: boolean } {
  const fences = extractFences(content);
  const dbmlFences = fences.filter(f => f.lang === 'dbml').map(f => f.body);
  if (dbmlFences.length > 0) return { source: dbmlFences.join('\n\n'), extractedFromFence: true };

  if (isMarkdownExt && /^(---|#)/.test(content)) {
    const genericFences = fences.filter(f => DBML_LOOKS_LIKE_RE.test(f.body)).map(f => f.body);
    if (genericFences.length > 0) return { source: genericFences.join('\n\n'), extractedFromFence: true };
  }
  return { source: content, extractedFromFence: false };
}

/** Read + (maybe) extract-from-markdown + parse, in one step. Shared by every `-i` command. */
export function parseDbmlFile(path: string): IR {
  const content = readFileSync(path, 'utf8');
  const isMarkdownExt = MARKDOWN_EXT_RE.test(path);
  const { source, extractedFromFence } = extractDbmlSource(content, isMarkdownExt);
  try {
    return parseDbml(source);
  } catch (e) {
    if (e instanceof DbmlParseError) {
      e.file = path;
      e.markdownNoFence = isMarkdownExt && !extractedFromFence;
    }
    throw e;
  }
}

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
    const line = diag?.location?.start?.line ?? null;
    const where = line ? ` (line ${line})` : '';
    const detail = diag?.message ?? e.message;
    const err = new DbmlParseError(`DBML parse failed${where}: ${detail}`, detail);
    err.line = line;
    throw err;
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
      meaning: null, generated: null, formula: null, valueSet: null,
    })),
    indexes: t.indexes.map((i: any): IndexDef => ({
      name: i.name ?? null,
      columns: i.columns.map((c: any) => String(c.value)),
      pk: !!i.pk,
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
