import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbml, parseDbmlFile, DbmlParseError } from '../src/parse.js';

const src = readFileSync(new URL('./fixtures/small.dbml', import.meta.url), 'utf8');

describe('parseDbml', () => {
  const ir = parseDbml(src);

  it('extracts tables and columns', () => {
    const users = ir.tables.find(t => t.name === 'users')!;
    expect(users.columns.map(c => c.name)).toEqual(['id', 'email', 'referred_by']);
    const email = users.columns[1];
    expect(email).toMatchObject({ type: 'varchar(100)', unique: true, notNull: true, note: 'login id' });
  });

  it('marks enum columns', () => {
    const status = ir.tables.find(t => t.name === 'orders')!.columns.find(c => c.name === 'status')!;
    expect(status.enumName).toBe('order_status');
    expect(status.default).toBe('pending');
  });

  it('extracts enums with value notes', () => {
    const e = ir.enums.find(e => e.name === 'order_status')!;
    expect(e.values).toEqual([
      { name: 'pending', note: 'awaiting payment', meaning: null },
      { name: 'shipped', note: null, meaning: null },
      { name: 'cancelled', note: null, meaning: null },
    ]);
  });

  it('extracts refs incl. self-ref, normalized to many-to-one', () => {
    expect(ir.refs).toContainEqual({
      fromTable: 'orders', fromColumns: ['user_id'],
      toTable: 'users', toColumns: ['id'], kind: 'many-to-one',
    });
    expect(ir.refs).toContainEqual({
      fromTable: 'users', fromColumns: ['referred_by'],
      toTable: 'users', toColumns: ['id'], kind: 'many-to-one',
    });
  });

  it('resolves domains: TableGroup > banner > ungrouped', () => {
    expect(ir.tables.find(t => t.name === 'users')!.domain).toBe('identity');
    expect(ir.tables.find(t => t.name === 'orders')!.domain).toBe('commerce');
    expect(ir.tables.find(t => t.name === 'audit_log')!.domain).toBe('commerce');
    expect(ir.tables.find(t => t.name === 'settings')!.domain).toBe('ungrouped');
    expect(ir.domains.map(d => d.slug)).toEqual(['identity', 'ungrouped', 'commerce']);
    expect(ir.domains.find(d => d.slug === 'ungrouped')).toMatchObject({ name: 'Ungrouped', tables: ['settings'] });
  });

  it('extracts composite indexes', () => {
    const orders = ir.tables.find(t => t.name === 'orders')!;
    expect(orders.indexes[0]).toMatchObject({ name: 'idx_user_status', columns: ['user_id', 'status'], pk: false });
  });

  it('extracts index-level composite pk', () => {
    const items = ir.tables.find(t => t.name === 'order_items')!;
    expect(items.indexes[0]).toMatchObject({ name: null, columns: ['order_id', 'line_no'], pk: true });
  });

  it('throws DbmlParseError with line info on bad input', () => {
    expect(() => parseDbml('Table x {')).toThrow(DbmlParseError);
  });
});

describe('parseDbmlFile — DBML embedded in Markdown', () => {
  it('extracts a single ```dbml fence from a markdown note', () => {
    const path = fileURLToPath(new URL('./fixtures/embedded-single.md', import.meta.url));
    const ir = parseDbmlFile(path);
    expect(ir.tables.map(t => t.name)).toEqual(['widgets']);
  });

  it('concatenates multiple ```dbml fences', () => {
    const path = fileURLToPath(new URL('./fixtures/embedded-multi.md', import.meta.url));
    const ir = parseDbmlFile(path);
    expect(ir.tables.map(t => t.name).sort()).toEqual(['gadgets', 'widgets']);
    expect(ir.refs).toContainEqual(expect.objectContaining({ fromTable: 'gadgets', toTable: 'widgets' }));
  });

  it('falls back to a generic ``` fence whose body looks like DBML', () => {
    const path = fileURLToPath(new URL('./fixtures/embedded-generic-fence.md', import.meta.url));
    const ir = parseDbmlFile(path);
    expect(ir.tables.map(t => t.name)).toEqual(['widgets']);
  });

  it('leaves a plain .dbml file unaffected by fence scanning', () => {
    const path = fileURLToPath(new URL('./fixtures/small.dbml', import.meta.url));
    const ir = parseDbmlFile(path);
    expect(ir.tables.map(t => t.name)).toContain('users');
  });

  it('throws a typed DbmlParseError with file + markdownNoFence hint when the fence content is garbage', () => {
    const path = fileURLToPath(new URL('./fixtures/embedded-garbage.md', import.meta.url));
    try {
      parseDbmlFile(path);
      expect.unreachable('expected parseDbmlFile to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DbmlParseError);
      const err = e as DbmlParseError;
      expect(err.file).toBe(path);
      // a ```dbml fence WAS found (just malformed inside), so no markdown-fence hint
      expect(err.markdownNoFence).toBe(false);
    }
  });

  it('sets markdownNoFence when a .md file with no fence at all fails to parse as raw DBML', () => {
    const path = fileURLToPath(new URL('./fixtures/small.md-no-fence.md', import.meta.url));
    try {
      parseDbmlFile(path);
      expect.unreachable('expected parseDbmlFile to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DbmlParseError);
      expect((e as DbmlParseError).markdownNoFence).toBe(true);
    }
  });
});
