import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbml } from '../src/parse.js';
import { loadOverlays, mergeOverlays } from '../src/overlay.js';
import { renderTable } from '../src/render/table.js';
import { renderIndex } from '../src/render/index.js';
import { renderDomain } from '../src/render/domain.js';

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
});
