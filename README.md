# dbmlgraph

[![CI](https://github.com/verryp/dbmlgraph/actions/workflows/ci.yml/badge.svg)](https://github.com/verryp/dbmlgraph/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dbmlgraph)](https://www.npmjs.com/package/dbmlgraph)
[![node](https://img.shields.io/node/v/dbmlgraph)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/dbmlgraph)](LICENSE)

DBML → LLM-ready markdown knowledge graph. Reads a `.dbml` schema, merges an optional
business-context overlay, and writes a set of plain markdown files (plus a JSONL export)
sized for AI coding agents to consume without any special tooling.

## What / Why

AI agents working against a database don't need raw DDL — they need schema *semantics*:
what a table is for, what a column means, how a derived value is computed, what each enum
value represents, and how tables relate to each other. Column types and foreign keys answer
"what", not "why", and "why" is what an agent needs to write a correct query or avoid a
subtle business-rule violation.

Existing schema-doc generators (`tbls`, `LLMSchema`, and similar tools) connect to a live
database and reflect its structure, but structure is all a live connection can offer — there
is no live column that holds "this formula sums order_items, not orders" or "status ACTIVE
means the branch is currently reporting actuals." dbmlgraph takes a different input:
DBML, the format schema authors already hand-write and annotate, often before the database
even exists. On top of the parsed DBML it merges a separate overlay layer — small YAML files,
one per table, that carry the business context DBML's own `note` fields don't have room for
(structured meanings, generated-value provenance, formulas, enum semantics). The overlay
never invents or overrides structure; it only annotates what the DBML already declares, and
`lint` catches drift the moment an overlay refers to a table or column that no longer exists.
Output is plain markdown any agent can `cat`, split into three grains — a schema-wide index,
one file per domain, one file per table — so a small-context agent loads only the slice it
needs, plus a JSONL export for RAG pipelines that want one chunk per table.

## Requirements

- **Node.js 20 or newer.** Check with `node --version`. npm ships with Node, so you need nothing else.
- **A DBML file.** Hand-written or exported from [dbdiagram.io](https://dbdiagram.io). dbmlgraph reads this file; it never connects to a database, so no driver, credentials, or running server are involved.
- **Overlay YAML files (optional).** Add these when you want business context on top of the schema. Skip them and the tool still runs on DBML alone.

No global config, no database connection, no network access at runtime.

## Install

```bash
npm i -g dbmlgraph
# or, without installing:
npx dbmlgraph --help
```

New to the tool? The [step-by-step guide](GUIDE.md) walks from an empty folder
to a full knowledge graph, covers every flag, and lists the behaviors that
surprise people. The rest of this README is the reference.

## Quick start

```bash
dbmlgraph generate -i schema.dbml --overlays overlays/ -o out/ --link-style md
dbmlgraph lint -i schema.dbml --overlays overlays/
dbmlgraph export -i schema.dbml --overlays overlays/ -o out/export.jsonl
```

`generate` writes:

```
out/
├── _index.md              # schema-wide index, one line per table, grouped by domain
├── domains/
│   ├── commerce.md         # tables in this domain + local ER diagram + cross-domain refs
│   ├── identity.md
│   └── ungrouped.md        # tables outside any TableGroup land here
└── tables/
    ├── orders.md            # full detail: columns, enums, relationships, indexes, rules
    ├── users.md
    ├── settings.md
    └── audit_log.md
```

## Overlay format

One YAML file per table, filename (minus extension) = table name. Every field is optional —
write only what adds context beyond the DBML itself.

```yaml
# overlays/branch.yml — file name = table name
purpose: >
  One-paragraph table purpose.
rules:
  - Business rule one
columns:
  some_column:
    meaning: What this column means
    generated: How the value is produced
    formula: "SUM(x * y)"
  status_column:
    enum:
      ACTIVE: what this value means
      CLOSED: what this one means
```

- `purpose` — one-paragraph description of what the table represents, shown under the
  table's `# name` heading and inlined next to its entry in `_index.md` and its domain page.
- `rules` — plain-language business rules, rendered as a `## Rules` list at the bottom of
  the table page.
- `columns.<name>.meaning` / `.generated` / `.formula` — free-form notes on a specific
  column, rendered in the column's `meaning` cell.
- `columns.<name>.enum` — maps enum value names to their business meaning. Only valid on a
  column whose DBML type is an enum; `dbmlgraph` resolves the enum by the column's declared
  type and applies the meanings to that enum's values.

## Output format

Sample table node (`tables/orders.md`), generated from the bundled test fixture:

```markdown
---
table: orders
domain: commerce
refs_out: [users]
refs_in: []
---
# orders
> Order header. One row per checkout.

## Columns
| column | type | constraints | meaning |
|---|---|---|---|
| id | bigint | PK, null |  |
| user_id | bigint | not null |  |
| status | order_status | null, default pending |  |
| total | numeric | not null | Formula: `SUM(order_items.qty * order_items.price)` |

## Enums
`order_status`: pending = awaiting payment confirmation · shipped = handed to courier · cancelled = user or system cancelled

## Relationships
- → [users](users.md) via user_id (many-to-one)

## Indexes
- idx_user_status on (user_id, status)

## Rules
- Never delete; cancel via status
```

## Lint rules

`dbmlgraph lint` exits `1` when any error is present, so it can gate CI. Warnings never
fail the build — they flag missing context, not broken overlays.

| Code | Severity | Meaning |
|---|---|---|
| E001 | error | Overlay file refers to a table that doesn't exist in the DBML |
| E002 | error | Overlay refers to a column that doesn't exist on that table |
| E003 | error | Overlay's `enum` block is on a non-enum column, or names a value the enum doesn't have |
| W001 | warning | Table has no overlay `purpose` |
| W002 | warning | Column has neither a DBML `note` nor an overlay `meaning` |
| W003 | warning | Enum value has neither a DBML `note` nor an overlay meaning |

`--exclude-columns` exempts a comma-separated column list (e.g. `id,created_at,updated_at`,
the built-in default) from W002 — housekeeping columns that rarely need a business
explanation.

## Link styles

`--link-style` controls how cross-references render in `generate` output only (`export`
has no such flag — its JSONL `text` is always `md` style, see RAG export shape below):

- `md` (default) — standard markdown relative links: `[users](../tables/users.md)`. Works
  in any renderer, GitHub included.
- `obsidian` — Obsidian wikilinks: `[[users]]`. Use this when the output directory is
  opened as (or copied into) an Obsidian vault.

## RAG export shape

`dbmlgraph export` writes one JSON object per line (JSONL), one chunk per table:

```json
{"id": "orders", "domain": "commerce", "refs_out": ["users"], "refs_in": [], "text": "# orders\n..."}
```

`text` is the same rendered table markdown as `tables/<name>.md` (always in `md` link
style, since embedding pipelines don't read wikilinks) — drop each line straight into a
vector store as one chunk.

## Roadmap

Ideas for future versions, roughly ordered by leverage. None are promises —
they're the directions that fit the tool's shape (DBML in, overlays annotate,
markdown out). Each notes where it would hook into the codebase. Pick one, open
an issue, keep the diff small.

### `init` — scaffold overlay stubs

The biggest authoring cost is writing one overlay YAML per table by hand. An
`init` command would read the DBML and emit an empty, correctly-keyed stub for
every table (all columns and enum values pre-listed, values blank) into the
overlays directory, so a human or agent only fills in meaning. Everything it
needs is already in the parsed IR (`src/parse.ts` → `src/ir.ts`); this is a new
`src/init.ts` plus a `cli.ts` command that writes files without clobbering
existing ones.

### `coverage` — overlay completeness as a metric

`lint` already knows which tables lack a `purpose` and which columns lack
meaning (`W001`/`W002`). A `coverage` command (or `lint --report`) would turn
those counts into a percentage per domain and overall — "72% of columns
documented" — so a large schema's annotation effort is trackable over time.
Pure derivation from the existing lint pass in `src/lint.ts`.

### `--watch` — regenerate on change

For the edit-schema / edit-overlay loop (and for schema-change automation
hooks), a `--watch` flag on `generate` that re-runs on file change would remove
the manual re-run step. `fs.watch` over the DBML file and overlays directory,
calling the existing `generate()`; no new dependency needed.

### `diff` — drift between two schema versions

`dbmlgraph diff old.dbml new.dbml` → the added/removed/changed tables, columns,
and relationships. This is what a schema-migration workflow actually wants:
"what rippled between these two versions." Two `parseDbml` calls and a
structural comparison over the `IR` — a new `src/diff.ts`, no rendering
changes.

### Schema-wide relationship view

Per-domain ER diagrams exist (`src/render/domain.ts`); there's no single view of
how domains connect to each other. A cross-domain edge summary (or Mermaid) in
`_index.md` would give the whole-schema picture at a glance. Reads `ir.refs` +
`ir.domains`, extends `src/render/index.ts`.

### Config file

A `dbmlgraph.config.json` (input path, overlays dir, out dir, link style,
column excludes) would replace repeated CLI flags for a project's standard
invocation. Loaded in `src/cli.ts`, with explicit flags overriding it.

## License

MIT — see [LICENSE](LICENSE).
