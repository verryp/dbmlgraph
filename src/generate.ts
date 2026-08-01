import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDbml } from './parse.js';
import { loadOverlays, mergeOverlays, type OverlayIssue } from './overlay.js';
import { renderTable } from './render/table.js';
import { renderIndex } from './render/index.js';
import { renderDomain } from './render/domain.js';
import type { LinkStyle } from './render/link.js';

export function generate(opts: { input: string; overlaysDir?: string; outDir: string; linkStyle: LinkStyle }): { written: string[]; issues: OverlayIssue[] } {
  const ir = parseDbml(readFileSync(opts.input, 'utf8'));
  const issues = opts.overlaysDir ? mergeOverlays(ir, loadOverlays(opts.overlaysDir)) : [];
  const written: string[] = [];
  const put = (rel: string, content: string) => {
    const p = join(opts.outDir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
    written.push(rel);
  };
  put('_index.md', renderIndex(ir, opts.linkStyle));
  for (const t of ir.tables) put(join('tables', `${t.name}.md`), renderTable(t, ir, opts.linkStyle));
  for (const d of ir.domains) put(join('domains', `${d.slug}.md`), renderDomain(d, ir, opts.linkStyle));
  return { written, issues };
}
