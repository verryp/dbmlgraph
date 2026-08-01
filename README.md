# dbmlgraph

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

## Install

```bash
npm i -g dbmlgraph
# or, without installing:
npx dbmlgraph --help
```

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
│   └── identity.md
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

`--link-style` controls how cross-references render, for both `generate` and inside the
`text` field of `export`'s JSONL:

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

## License

MIT — see [LICENSE](LICENSE).
