import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { parseDbmlFile } from './parse.js';
import type { IR, TableNode } from './ir.js';

// Columns whose meaning is boilerplate — omitted from stubs (mirrors lint DEFAULT_EXCLUDES).
const DEFAULT_EXCLUDES = ['id', 'created_at', 'updated_at'];

/** Render one table's stub overlay object (structure valid, meanings blank → W00x, not E00x). */
export function stubOverlay(table: TableNode, ir: IR, exclude: Set<string>): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const c of table.columns) {
    if (exclude.has(c.name)) continue;
    if (c.enumName) {
      const enumDef = ir.enums.find(e => e.name === c.enumName);
      const enumMap: Record<string, string> = {};
      for (const v of enumDef?.values ?? []) enumMap[v.name] = '';
      columns[c.name] = { enum: enumMap };
    } else {
      columns[c.name] = { meaning: '' };
    }
  }
  return { purpose: '', rules: [], columns };
}

export function init(opts: { input: string; outDir: string; excludeColumns?: string[] }): { written: string[]; skipped: string[] } {
  const ir = parseDbmlFile(opts.input);
  const exclude = new Set(opts.excludeColumns ?? DEFAULT_EXCLUDES);
  mkdirSync(opts.outDir, { recursive: true });

  // No-clobber: an overlay for a table already exists if <table>.yml or <table>.yaml is present.
  const existing = new Set(
    readdirSync(opts.outDir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => f.replace(/\.ya?ml$/, '')),
  );

  const written: string[] = [];
  const skipped: string[] = [];
  for (const t of ir.tables) {
    if (existing.has(t.name)) { skipped.push(`${t.name}.yml`); continue; }
    const rel = `${t.name}.yml`;
    writeFileSync(resolve(opts.outDir, rel), stringify(stubOverlay(t, ir, exclude)));
    written.push(rel);
  }
  return { written, skipped };
}
