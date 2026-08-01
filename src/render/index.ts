import type { IR } from '../ir.js';
import { link, type LinkStyle } from './link.js';

export function renderIndex(ir: IR, style: LinkStyle): string {
  const L: string[] = ['# Schema Index', ''];
  if (ir.databaseName) L.splice(1, 0, `Database: ${ir.databaseName}`);
  L.push(`${ir.tables.length} tables · ${ir.domains.length} domains. One line per table; open the table node for full detail.`);
  L.push('');
  for (const d of ir.domains) {
    const domainLink = style === 'obsidian' ? `[[${d.slug}]]` : `[${d.name}](domains/${d.slug}.md)`;
    L.push(`## ${d.name} (${domainLink})`);
    for (const name of d.tables) {
      const t = ir.tables.find(t => t.name === name)!;
      const hook = (t.purpose ?? t.note ?? '').replace(/\n+/g, ' ').trim();
      L.push(`- ${link(name, style, 'root')}${hook ? ` — ${hook}` : ''}`);
    }
    L.push('');
  }
  return L.join('\n');
}
