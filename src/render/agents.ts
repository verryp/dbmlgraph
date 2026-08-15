import type { IR } from '../ir.js';

// AGENTS.md — landing doc for an AI agent that opens this output dir cold.
// Regenerated on every `dbmlgraph generate`; do not hand-edit.
export function renderAgents(ir: IR): string {
  const dbLine = ir.databaseName ? ` for \`${ir.databaseName}\`` : '';
  const domainNames = ir.domains.map(d => d.name);
  const L: string[] = [];

  L.push('# AGENTS.md');
  L.push('');
  L.push(`Generated schema knowledge graph${dbLine}, produced from DBML via dbmlgraph and regenerated on every schema change. Do not hand-edit any file in this directory — edits are overwritten on the next \`generate\` run.`);
  L.push('');

  L.push('## How to navigate');
  L.push('');
  L.push('Progressive disclosure — go only as deep as the task needs:');
  L.push('');
  L.push('1. `_index.md` — every table, one line each, grouped by domain.');
  L.push('2. `domains/<domain>.md` — a domain slice with an ER diagram of its local tables and cross-domain refs.');
  L.push('3. `tables/<table>.md` — full detail for one table. Open only the tables the task actually touches.');
  L.push('');
  L.push("Don't read the whole tree — start at `_index.md` and drill down.");
  L.push('');

  L.push('## Table file anatomy');
  L.push('');
  L.push('Each `tables/<table>.md` has YAML frontmatter:');
  L.push('');
  L.push('- `table` — table name.');
  L.push('- `domain` — owning domain slug.');
  L.push('- `refs_out` — tables this table points to (its FKs).');
  L.push('- `refs_in` — tables pointing to this table, i.e. the dependency / blast-radius set: anything here breaks or cascades if this table changes.');
  L.push('');
  L.push('Body sections:');
  L.push('');
  L.push('- **Columns** — types and constraints; `meaning` carries business context pulled from overlays, not just the raw DBML note.');
  L.push('- **Enums** — allowed values, each with its business meaning.');
  L.push('- **Relationships** — direction arrows and cardinality to other tables.');
  L.push('- **Indexes** — defined indexes, including uniqueness.');
  L.push('- **Rules** — business rules from overlays; treat these as constraints when writing queries against this table.');
  L.push('');

  L.push('## Fastest path: the query command');
  L.push('');
  L.push('If the `dbmlgraph` CLI is available, prefer `dbmlgraph query <table...>` over opening multiple files — it prints a self-contained context pack (the table plus neighbor summaries and rules) straight to stdout.');
  L.push('');
  L.push('```');
  L.push('dbmlgraph query orders');
  L.push('```');
  L.push('');

  L.push(`## Stats`);
  L.push('');
  L.push(`${ir.tables.length} tables · ${ir.domains.length} domains: ${domainNames.join(', ')}.`);
  L.push('');

  return L.join('\n');
}
