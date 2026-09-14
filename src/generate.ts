import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseDbmlFile } from './parse.js';
import { loadOverlays, mergeOverlays, type OverlayIssue } from './overlay.js';
import { renderTable } from './render/table.js';
import { renderIndex } from './render/index.js';
import { renderDomain } from './render/domain.js';
import { renderAgents } from './render/agents.js';
import type { LinkStyle } from './render/link.js';

export function generate(opts: { input: string; overlaysDir?: string; outDir: string; linkStyle: LinkStyle; prune?: boolean }): { written: string[]; issues: OverlayIssue[]; pruned: string[] } {
  const ir = parseDbmlFile(opts.input);
  const issues = opts.overlaysDir ? mergeOverlays(ir, loadOverlays(opts.overlaysDir)) : [];
  const written: string[] = [];
  const resolvedOutDir = resolve(opts.outDir);
  const put = (rel: string, content: string) => {
    const p = resolve(opts.outDir, rel);
    if (p !== resolvedOutDir && !p.startsWith(resolvedOutDir + sep)) {
      throw new Error(`refusing to write outside outDir: ${rel}`);
    }
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
    written.push(rel);
  };
  // Generated subdirectories are tool-owned: a rename or a dropped table must not
  // leave last run's file behind. Confined to domains/ and tables/ and to .md files --
  // the output root holds export.jsonl, which generate does not write.
  const prune = (dir: string): string[] => {
    const abs = resolve(opts.outDir, dir);
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      return [];
    }
    const removed: string[] = [];
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const rel = join(dir, name);
      if (written.includes(rel)) continue;
      rmSync(resolve(abs, name));
      removed.push(rel);
    }
    return removed;
  };

  put('_index.md', renderIndex(ir, opts.linkStyle));
  put('AGENTS.md', renderAgents(ir));
  for (const t of ir.tables) put(join('tables', `${t.name}.md`), renderTable(t, ir, opts.linkStyle));
  for (const d of ir.domains) put(join('domains', `${d.slug}.md`), renderDomain(d, ir, opts.linkStyle));
  const pruned = opts.prune === false ? [] : [...prune('domains'), ...prune('tables')];
  return { written, issues, pruned };
}
