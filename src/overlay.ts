import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { IR } from './ir.js';

const overlaySchema = z.object({
  purpose: z.string().optional(),
  rules: z.array(z.string()).default([]),
  columns: z.record(z.string(), z.object({
    meaning: z.string().optional(),
    generated: z.string().optional(),
    formula: z.string().optional(),
    enum: z.record(z.string(), z.string()).optional(),
    // varchar columns whose allowed values live in a `note: 'A | B | C'` string.
    // `open: true` marks the list illustrative ('e.g. ...'), not exhaustive.
    open: z.boolean().optional(),
    values: z.record(z.string(), z.string()).optional(),
  })).default({}),
});
export type Overlay = z.infer<typeof overlaySchema>;
export interface OverlayIssue { code: 'E001' | 'E002' | 'E003'; table: string; detail: string }

export class OverlayFormatError extends Error {}

export function loadOverlays(dir: string): Map<string, Overlay> {
  const out = new Map<string, Overlay>();
  const errors: string[] = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml')).sort()) {
    try {
      out.set(basename(f).replace(/\.ya?ml$/, ''), overlaySchema.parse(parseYaml(readFileSync(join(dir, f), 'utf8')) ?? {}));
    } catch (e: any) {
      errors.push(`${f}: ${e.message}`);
    }
  }
  if (errors.length) throw new OverlayFormatError(`Invalid overlay file(s):\n${errors.join('\n')}`);
  return out;
}

export function mergeOverlays(ir: IR, overlays: Map<string, Overlay>): OverlayIssue[] {
  const issues: OverlayIssue[] = [];
  for (const [tableName, ov] of overlays) {
    const table = ir.tables.find(t => t.name === tableName);
    if (!table) { issues.push({ code: 'E001', table: tableName, detail: `overlay for unknown table` }); continue; }
    if (ov.purpose) table.purpose = ov.purpose.trim();
    table.rules = ov.rules;
    for (const [colName, colOv] of Object.entries(ov.columns)) {
      const col = table.columns.find(c => c.name === colName);
      if (!col) { issues.push({ code: 'E002', table: tableName, detail: `unknown column '${colName}'` }); continue; }
      col.meaning = colOv.meaning ?? col.meaning;
      col.generated = colOv.generated ?? col.generated;
      col.formula = colOv.formula ?? col.formula;
      if (colOv.enum) {
        const enumDef = col.enumName ? ir.enums.find(e => e.name === col.enumName) : undefined;
        if (!enumDef) { issues.push({ code: 'E003', table: tableName, detail: `column '${colName}' is not an enum` }); continue; }
        for (const [val, meaning] of Object.entries(colOv.enum)) {
          const v = enumDef.values.find(v => v.name === val);
          if (!v) { issues.push({ code: 'E003', table: tableName, detail: `enum '${enumDef.name}' has no value '${val}'` }); continue; }
          v.meaning = meaning;
        }
      }
      if (colOv.values) {
        col.valueSet = {
          open: colOv.open ?? false,
          values: Object.entries(colOv.values).map(([value, meaning]) => ({ value, meaning })),
        };
      }
    }
  }
  return issues;
}
