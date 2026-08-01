import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDbml, DbmlParseError } from '../src/parse.js';

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
    expect(ir.domains.map(d => d.slug)).toEqual(['identity', 'commerce']);
  });

  it('extracts composite indexes', () => {
    const orders = ir.tables.find(t => t.name === 'orders')!;
    expect(orders.indexes[0]).toMatchObject({ name: 'idx_user_status', columns: ['user_id', 'status'] });
  });

  it('throws DbmlParseError with line info on bad input', () => {
    expect(() => parseDbml('Table x {')).toThrow(DbmlParseError);
  });
});
