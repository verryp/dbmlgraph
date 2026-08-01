import type { IR } from './ir.js';
import type { OverlayIssue } from './overlay.js';

export interface Finding { code: string; table: string; detail: string }
export interface LintResult { errors: Finding[]; warnings: Finding[] }

const DEFAULT_EXCLUDES = ['id', 'created_at', 'updated_at'];

export function lint(ir: IR, overlayIssues: OverlayIssue[], opts: { excludeColumns?: string[] } = {}): LintResult {
  const exclude = new Set(opts.excludeColumns ?? DEFAULT_EXCLUDES);
  const errors: Finding[] = overlayIssues.map(i => ({ code: i.code, table: i.table, detail: i.detail }));
  const warnings: Finding[] = [];

  for (const t of ir.tables) {
    if (!t.purpose) warnings.push({ code: 'W001', table: t.name, detail: 'table has no overlay purpose' });
    for (const c of t.columns) {
      if (exclude.has(c.name)) continue;
      if (!c.note && !c.meaning) warnings.push({ code: 'W002', table: t.name, detail: `column '${c.name}' has no note or meaning` });
    }
  }
  for (const e of ir.enums) {
    for (const v of e.values) {
      if (!v.note && !v.meaning) warnings.push({ code: 'W003', table: e.name, detail: `enum value '${v.name}' has no meaning` });
    }
  }
  return { errors, warnings };
}
