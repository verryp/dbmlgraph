import type { IR } from './ir.js';
import { renderTable } from './render/table.js';

export function exportJsonl(ir: IR): string {
  return ir.tables.map(t => {
    const refsOut = [...new Set(ir.refs.filter(r => r.fromTable === t.name).map(r => r.toTable))].sort();
    const refsIn = [...new Set(ir.refs.filter(r => r.toTable === t.name && r.fromTable !== t.name).map(r => r.fromTable))].sort();
    return JSON.stringify({ id: t.name, domain: t.domain, refs_out: refsOut, refs_in: refsIn, text: renderTable(t, ir, 'md') });
  }).join('\n') + '\n';
}
