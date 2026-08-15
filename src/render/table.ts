import type { IR, TableNode, Column } from '../ir.js';
import { link, type LinkStyle } from './link.js';

/** Constraint cell for a column row — shared with the `query` neighbor tables. */
export function columnConstraints(c: Column): string {
  return [
    c.pk && 'PK', c.increment && 'auto', c.unique && 'unique',
    c.notNull ? 'not null' : 'null', c.default != null && `default ${c.default}`,
  ].filter(Boolean).join(', ');
}

/** Per-table YAML frontmatter — split out so callers that compose their own
 *  header (e.g. `query`, which merges one block for the whole pack) can skip it. */
export function tableFrontmatter(t: TableNode, ir: IR): string {
  const refsOut = ir.refs.filter(r => r.fromTable === t.name);
  const refsIn = ir.refs.filter(r => r.toTable === t.name && r.fromTable !== t.name);
  return [
    '---',
    `table: ${t.name}`,
    `domain: ${t.domain}`,
    `refs_out: [${[...new Set(refsOut.map(r => r.toTable))].sort().join(', ')}]`,
    `refs_in: [${[...new Set(refsIn.map(r => r.fromTable))].sort().join(', ')}]`,
    '---',
  ].join('\n');
}

/** Node body without frontmatter. `rules: false` drops the Rules section for
 *  callers that merge rules across several tables. */
export function renderTableBody(t: TableNode, ir: IR, style: LinkStyle, opts: { rules?: boolean } = {}): string {
  const refsOut = ir.refs.filter(r => r.fromTable === t.name);
  const refsIn = ir.refs.filter(r => r.toTable === t.name && r.fromTable !== t.name);
  const L: string[] = [];

  L.push(`# ${t.name}`);
  const blurb = t.purpose ?? t.note;
  if (blurb) L.push(`> ${blurb.replace(/\n+/g, ' ').trim()}`);
  L.push('');

  L.push('## Columns');
  L.push('| column | type | constraints | meaning |');
  L.push('|---|---|---|---|');
  for (const c of t.columns) {
    const cons = columnConstraints(c);
    const meaning = [c.meaning ?? c.note, c.generated && `Generated: ${c.generated}`, c.formula && `Formula: \`${c.formula}\``]
      .filter(Boolean).join(' · ');
    const esc = (s: string) => s.replace(/\|/g, '\\|');
    L.push(`| ${c.name} | ${esc(c.type)} | ${esc(cons)} | ${esc(meaning)} |`);
  }
  L.push('');

  const enumsUsed = [...new Set(t.columns.map(c => c.enumName).filter((n): n is string => !!n))]
    .map(n => ir.enums.find(e => e.name === n)!);
  const valueSetCols = t.columns.filter(c => c.valueSet);
  if (enumsUsed.length || valueSetCols.length) {
    L.push('## Enums');
    for (const e of enumsUsed) {
      const parts = e.values.map(v => {
        const m = v.meaning ?? v.note;
        return m ? `${v.name} = ${m}` : v.name;
      });
      L.push(`\`${e.name}\`: ${parts.join(' · ')}`);
    }
    for (const c of valueSetCols) {
      const vs = c.valueSet!;
      L.push(`\`${c.name}\`${vs.open ? ' (open — illustrative, not exhaustive)' : ''}`);
      for (const v of vs.values) L.push(`- \`${v.value}\` — ${v.meaning}`);
    }
    L.push('');
  }

  if (refsOut.length || refsIn.length) {
    L.push('## Relationships');
    for (const r of refsOut.sort((a, b) => a.toTable.localeCompare(b.toTable)))
      L.push(`- → ${link(r.toTable, style, 'tables')} via ${r.fromColumns.join(', ')} (${r.kind})`);
    for (const r of refsIn.sort((a, b) => a.fromTable.localeCompare(b.fromTable)))
      L.push(`- ← ${link(r.fromTable, style, 'tables')} via ${r.fromColumns.join(', ')} (${r.kind})`);
    L.push('');
  }

  if (t.indexes.length) {
    L.push('## Indexes');
    for (const i of t.indexes)
      L.push(`- ${i.name ?? '(unnamed)'} on (${i.columns.join(', ')})${i.unique ? ' unique' : ''}${i.note ? ` — ${i.note}` : ''}`);
    L.push('');
  }

  if (t.rules.length && opts.rules !== false) {
    L.push('## Rules');
    for (const r of t.rules) L.push(`- ${r}`);
    L.push('');
  }

  return L.join('\n');
}

export function renderTable(t: TableNode, ir: IR, style: LinkStyle): string {
  return `${tableFrontmatter(t, ir)}\n${renderTableBody(t, ir, style)}`;
}
