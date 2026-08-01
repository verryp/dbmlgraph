import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbml } from '../src/parse.js';
import { loadOverlays, mergeOverlays } from '../src/overlay.js';
import { link } from '../src/render/link.js';
import { renderTable } from '../src/render/table.js';
import { renderIndex } from '../src/render/index.js';
import { renderDomain } from '../src/render/domain.js';
import type { IR, TableNode } from '../src/ir.js';

function mergedIr() {
  const ir = parseDbml(readFileSync(new URL('./fixtures/small.dbml', import.meta.url), 'utf8'));
  mergeOverlays(ir, loadOverlays(fileURLToPath(new URL('./fixtures/overlays/', import.meta.url))));
  return ir;
}

describe('render', () => {
  const ir = mergedIr();

  it('table node — obsidian links', () => {
    expect(renderTable(ir.tables.find(t => t.name === 'orders')!, ir, 'obsidian')).toMatchSnapshot();
  });
  it('table node — md links resolve relative from tables/', () => {
    const md = renderTable(ir.tables.find(t => t.name === 'orders')!, ir, 'md');
    expect(md).toContain('[users](users.md)');
  });
  it('index lists every table once under its domain', () => {
    const md = renderIndex(ir, 'obsidian');
    expect(md).toMatchSnapshot();
    for (const t of ir.tables) expect(md).toContain(t.name);
  });
  it('domain file has mermaid ER with local refs only', () => {
    const md = renderDomain(ir.domains.find(d => d.slug === 'commerce')!, ir, 'md');
    expect(md).toContain('```mermaid');
    expect(md).toContain('erDiagram');
    expect(md).toMatchSnapshot();
  });

  it('link resolves md paths per fromDir', () => {
    expect(link('x', 'md', 'root')).toBe('[x](tables/x.md)');
    expect(link('x', 'md', 'tables')).toBe('[x](x.md)');
    expect(link('x', 'md', 'domains')).toBe('[x](../tables/x.md)');
    expect(link('x', 'obsidian', 'domains')).toBe('[[x]]');
  });

  it('domain mermaid ER maps ref kinds to cardinality glyphs', () => {
    const table = (name: string): TableNode =>
      ({ name, domain: 'd', note: null, columns: [], indexes: [], purpose: null, rules: [] });
    const miniIr: IR = {
      databaseName: null,
      domains: [{ slug: 'd', name: 'D', tables: ['a', 'b'] }],
      tables: [table('a'), table('b')],
      enums: [],
      refs: [
        { fromTable: 'a', fromColumns: ['b_id'], toTable: 'b', toColumns: ['id'], kind: 'many-to-one' },
        { fromTable: 'a', fromColumns: ['b_uid'], toTable: 'b', toColumns: ['uid'], kind: 'one-to-one' },
        { fromTable: 'a', fromColumns: ['tag'], toTable: 'b', toColumns: ['tag'], kind: 'many-to-many' },
      ],
    };
    const md = renderDomain(miniIr.domains[0], miniIr, 'md');
    expect(md).toContain('a }o--|| b : "b_id"');
    expect(md).toContain('a ||--|| b : "b_uid"');
    expect(md).toContain('a }o--o{ b : "tag"');
  });
});
