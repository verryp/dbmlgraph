import type { IR, Domain } from '../ir.js';
import { link, type LinkStyle } from './link.js';

export function renderDomain(d: Domain, ir: IR, style: LinkStyle): string {
  const inDomain = new Set(d.tables);
  const localRefs = ir.refs.filter(r => inDomain.has(r.fromTable) && inDomain.has(r.toTable));
  const outboundRefs = ir.refs.filter(r => inDomain.has(r.fromTable) !== inDomain.has(r.toTable));

  const L: string[] = ['---', `domain: ${d.slug}`, '---', `# Domain: ${d.name}`, ''];
  L.push('## Tables');
  for (const name of d.tables) {
    const t = ir.tables.find(t => t.name === name)!;
    const hook = (t.purpose ?? t.note ?? '').replace(/\n+/g, ' ').trim();
    L.push(`- ${link(name, style, 'domains')}${hook ? ` — ${hook}` : ''}`);
  }
  L.push('');

  L.push('## ER (local)');
  L.push('```mermaid');
  L.push('erDiagram');
  for (const name of d.tables) L.push(`  ${name}`);
  for (const r of localRefs) {
    const card = r.kind === 'one-to-one' ? '||--||' : r.kind === 'many-to-many' ? '}o--o{' : '}o--||';
    L.push(`  ${r.fromTable} ${card} ${r.toTable} : "${r.fromColumns.join(',')}"`);
  }
  L.push('```');
  L.push('');

  if (outboundRefs.length) {
    L.push('## Cross-domain refs');
    for (const r of outboundRefs.sort((a, b) => (a.fromTable + a.toTable).localeCompare(b.fromTable + b.toTable))) {
      const external = inDomain.has(r.fromTable) ? r.toTable : r.fromTable;
      const extDomain = ir.tables.find(t => t.name === external)?.domain;
      L.push(`- ${r.fromTable} → ${r.toTable} (${r.fromColumns.join(', ')}) — external table in \`${extDomain}\``);
    }
    L.push('');
  }
  return L.join('\n');
}
