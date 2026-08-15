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

## How it compares

The closest tools solve a different problem: they document a database that
already exists, by connecting to it. dbmlgraph works from DBML you write, and
its whole point is the business-context layer a live connection can't provide.

| | **dbmlgraph** | [tbls](https://github.com/k1LoW/tbls) | [@dbml/cli](https://github.com/holistics/dbml) |
|---|---|---|---|
| Input | DBML file | Live database (DSN) | DBML file |
| Needs a DB connection | No | Yes | No |
| Business-context layer (meaning, formulas, enum semantics) | Yes, via overlays | Column comments only | No |
| Built for LLM / agent consumption | Yes | No (human docs) | No |
| RAG export (JSONL, one chunk per table) | Yes | No | No |
| Output split by grain (index / domain / table) | Yes | Per-table pages | No |
| Lint for documentation gaps | Yes (`W001`–`W003`) | Yes (column comments) | No |
| ER diagrams | Per-domain (Mermaid) | Yes (many formats) | No |
| Primary job | Feed schema *meaning* to AI agents | Document a live DB in CI | Convert DBML ↔ SQL |

Use `tbls` when you have a running database and want rich human documentation
in CI. Use `@dbml/cli` when you want to turn DBML into SQL or vice versa. Use
dbmlgraph when an AI agent needs to understand what your schema *means*, not
just its shape.

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
dbmlgraph init -i schema.dbml -o overlays/                 # scaffold blank overlay stubs (once, per new schema)
dbmlgraph generate -i schema.dbml --overlays overlays/ -o out/ --link-style md
dbmlgraph lint -i schema.dbml --overlays overlays/
dbmlgraph export -i schema.dbml --overlays overlays/ -o out/export.jsonl
```

`init` reads the DBML and emits one blank, correctly-keyed overlay stub per table
(every column and enum value pre-listed, meanings blank) into the overlays
directory — so you only fill in meaning, never the mechanical scaffold. It never
overwrites an existing overlay file; already-authored tables are skipped and
reported. `id`, `created_at`, `updated_at` are omitted by default (override with
`--exclude-columns`).

### Config file

Drop a `.dbmlgraph.yml` in your project root and run the commands with no flags:

```yaml
# .dbmlgraph.yml
input: schema.dbml
overlays: overlays/
out: graph/
linkStyle: obsidian        # obsidian | md
# excludeColumns: [id, created_at, updated_at]
```

```bash
dbmlgraph generate     # reads .dbmlgraph.yml — no repeated flags
dbmlgraph lint
dbmlgraph export       # writes JSONL to `out`
dbmlgraph init         # writes stubs to `overlays`
```

Every key is optional. An explicit flag always overrides the config
(`generate --link-style md` beats `linkStyle: obsidian`). Point at a different
file with `-c/--config <path>`; a missing default file is fine (config is
optional), but a missing explicit `--config` path is an error. For `init`, the
config's `overlays` is the stub destination (`out` is only used by
`generate`/`export`).

`generate` writes:

```
out/
├── AGENTS.md               # navigation instructions for AI agents landing in this dir
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

`generate` always writes `AGENTS.md` at the output root — a landing doc that tells
an AI agent dropped into this directory how to navigate it (start at `_index.md`,
drill into `domains/` then `tables/`, prefer `dbmlgraph query` over opening files
by hand). It's regenerated on every run, so don't hand-edit it; edits are
overwritten on the next `generate`.

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
  channel:                          # varchar column whose values live in a note string
    values:
      WEB: Online storefront
      POS: In-store point of sale
  data_type:
    open: true                      # values are illustrative, not exhaustive
    values:
      ACTUAL_PRODUCTION_MO: MO-level production actuals
```

- `purpose` — one-paragraph description of what the table represents, shown under the
  table's `# name` heading and inlined next to its entry in `_index.md` and its domain page.
- `rules` — plain-language business rules, rendered as a `## Rules` list at the bottom of
  the table page.
- `columns.<name>.meaning` / `.generated` / `.formula` — free-form notes on a specific
  column, rendered in the column's `meaning` cell. When `meaning` is set it replaces the
  DBML `note` for that column (the note is not appended); leave it blank to fall back to
  the note.
- `columns.<name>.enum` — maps enum value names to their business meaning. Only valid on a
  column whose DBML type is an enum; `dbmlgraph` resolves the enum by the column's declared
  type and applies the meanings to that enum's values.
- `columns.<name>.values` — maps allowed values to their meaning for a **varchar** column
  whose value set lives in a `note: 'A | B | C'` string rather than a DBML enum. Rendered as
  a structured entry under `## Enums`. Set `columns.<name>.open: true` when the values are
  illustrative (`e.g. ...`) rather than an exhaustive closed set.

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

## Context packs for agents

`dbmlgraph query <table...>` prints one self-contained context pack to stdout —
built for pasting into an agent, so it never has to guess which files to open:

```bash
dbmlgraph query order_items orders -i schema.dbml --overlays overlays/
```

Full nodes for the queried tables, then one-line summaries of their neighbors,
then merged rules — deduped across the whole pack. A queried table never shows up
as its own neighbor, a neighbor shared by two queried tables prints once, and
repeated FKs between the same pair collapse with a `(2 refs collapsed)` note.
The footer names the tables just outside the pack and the command that fetches them.

| flag | default | meaning |
|---|---|---|
| `--depth <n>` | `1` | neighbor hops, capped at 2. `0` drops the Neighbors section |
| `--budget <tokens>` | adaptive | by default the cap is sized to fit the queried nodes and every depth-1 neighbor in full (min `4000`), so a hub table is never degraded on a plain invocation; pass a number for a hard cap. Neighbors are ranked (distance, then FK degree, then name) and cut from the tail; queried nodes are never cut |
| `--columns key\|all` | `key` | `all` gives each neighbor a compact PK/FK/enum column table |
| `--format md\|json` | `md` | `json` mirrors the same sections as keys |
| `--strict` | off | exact names only. Without it, a close name (case, or edit distance ≤2) is accepted when unambiguous |

Truncation is never silent — a cut list always ends in a counted
`… and N more (raise --budget or --depth)` label. An unresolvable name exits `1`
after printing the three closest table names.

Does the pack actually work? We benchmarked it blind against a 70-table
production schema: fresh agent sessions wrote SQL from either a pack (4–8k
tokens) or the full raw DBML (~27k tokens). The pack matched or beat raw-dump
accuracy at 3.5–6x less context, and on the hardest rule-dependent task the
pack arm produced the only fully-correct answer. Method, results, and the two
design changes the benchmark forced: [docs/benchmark.md](docs/benchmark.md).

## Roadmap

Ideas for future versions, roughly ordered by leverage. None are promises —
they're the directions that fit the tool's shape (DBML in, overlays annotate,
markdown out). Each notes where it would hook into the codebase. Pick one, open
an issue, keep the diff small.

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

### MCP server (phase 2)

`query` was built pure and side-effect-free on purpose (`buildPack` in
`src/query.ts` takes an `IR` and options, returns a pack — no I/O, no process
exit) so it could be reused outside the CLI. An MCP server exposing a single
tool, `dbmlgraph_query`, would wrap that same function directly — CLI output
and MCP output would be identical by construction, not two implementations to
keep in sync.

## License

MIT — see [LICENSE](LICENSE).
