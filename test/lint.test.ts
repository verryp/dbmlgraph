import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbml } from '../src/parse.js';
import { loadOverlays, mergeOverlays } from '../src/overlay.js';
import { lint } from '../src/lint.js';

const src = readFileSync(new URL('./fixtures/small.dbml', import.meta.url), 'utf8');
const dir = fileURLToPath(new URL('./fixtures/overlays/', import.meta.url));

describe('lint', () => {
  it('overlay drift issues become errors', () => {
    const ir = parseDbml(src);
    const overlays = loadOverlays(dir);
    overlays.set('ghost', { purpose: 'x', rules: [], columns: {} });
    const res = lint(ir, mergeOverlays(ir, overlays));
    expect(res.errors).toContainEqual(expect.objectContaining({ code: 'E001' }));
  });

  it('W001 table without purpose; W002 column without meaning respects excludes; W003 enum value uncovered', () => {
    const ir = parseDbml(src);
    const res = lint(ir, mergeOverlays(ir, loadOverlays(dir)));
    // audit_log has no overlay
    expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'W001', table: 'audit_log' }));
    // audit_log.payload has no note/meaning; audit_log.id excluded by default
    expect(res.warnings).toContainEqual(expect.objectContaining({ code: 'W002', table: 'audit_log', detail: expect.stringContaining('payload') }));
    expect(res.warnings).not.toContainEqual(expect.objectContaining({ code: 'W002', detail: expect.stringContaining("'id'") }));
    // all order_status values covered by overlay → no W003
    expect(res.warnings.filter(w => w.code === 'W003')).toEqual([]);
  });
});
