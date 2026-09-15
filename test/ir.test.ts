import { describe, it, expect } from 'vitest';
import type { IR } from '../src/ir.js';

describe('ir', () => {
  it('types are importable', () => {
    const ir: IR = { databaseName: null, domains: [], tables: [], enums: [], refs: [], banners: [] };
    expect(ir.tables).toEqual([]);
  });
});
