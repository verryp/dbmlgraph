# dbmlgraph — Step-by-step guide

This guide takes you from an empty folder to a full knowledge graph. It covers
every command, every flag, and the behaviors that trip people up. Read the
[README](README.md) for the terse reference; read this when you want to
understand what the tool does and why.

## Table of contents

1. [What you need](#1-what-you-need)
2. [Your first graph in 60 seconds](#2-your-first-graph-in-60-seconds)
3. [The three commands](#3-the-three-commands)
4. [Overlays: adding business context](#4-overlays-adding-business-context)
5. [How domains are decided](#5-how-domains-are-decided)
6. [Linting your schema](#6-linting-your-schema)
7. [Link styles: Obsidian vs plain markdown](#7-link-styles-obsidian-vs-plain-markdown)
8. [The RAG export](#8-the-rag-export)
9. [Behaviors worth knowing](#9-behaviors-worth-knowing)
10. [Full flag reference](#10-full-flag-reference)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. What you need

- **Node.js 20 or newer.** Run `node --version` to check.
- **One DBML file.** Write it by hand or export it from
  [dbdiagram.io](https://dbdiagram.io). The tool reads this file and nothing
  else. It never opens a database connection, so you need no driver, no
  credentials, and no running server.
- **Overlay YAML files** only if you want to layer business meaning on top of
  the raw schema. They are optional. Everything runs on DBML alone.

Install it globally, or skip the install and prefix every command with `npx`:

```bash
npm i -g dbmlgraph      # then: dbmlgraph <command>
# or
npx dbmlgraph <command> # no install, downloads on first run
```

The examples below use the bare `dbmlgraph` form.

---

## 2. Your first graph in 60 seconds

Create a file called `schema.dbml`:

```dbml
Table users {
  id int [pk]
  email varchar(255) [unique, not null]
}

Table orders {
  id int [pk]
  user_id int [not null]
  total decimal
  status order_status
}

Ref: orders.user_id > users.id

Enum order_status {
  active
  suspended
}
```

Generate the graph:

```bash
dbmlgraph generate -i schema.dbml -o graph
```

You now have a `graph/` folder:

```
graph/
  _index.md          # one line per table, grouped by domain
  tables/
    users.md         # columns, enums, relationships, indexes
    orders.md
  domains/
    ungrouped.md     # a Mermaid ER diagram of this domain
```

Open `graph/_index.md`. Every table links to its own page. Open
`graph/tables/orders.md` and you see the `orders` → `users` relationship
spelled out. That is the whole tool: a schema you can read and an LLM can
follow, with no database attached.

The tables landed in a domain named "ungrouped" because you have not grouped
them yet. [Section 5](#5-how-domains-are-decided) fixes that.

---

## 3. The three commands

dbmlgraph does three things. Each one reads your DBML; two of them also read
overlays.

| Command | Reads | Produces |
|---|---|---|
| `generate` | DBML + overlays | A folder of markdown pages |
| `export` | DBML + overlays | One JSONL file for RAG |
| `lint` | DBML + overlays | Findings on stdout, nothing written |

`generate` is the one you run most. `export` feeds a retrieval pipeline.
`lint` checks that your schema and overlays stay documented and consistent.

Run any of them with `--help` to see its flags:

```bash
dbmlgraph generate --help
```

---

## 4. Overlays: adding business context

DBML tells the tool your table structure. It cannot tell the tool what a
column *means*, why a status exists, or how a total gets computed. Overlays
carry that.

An overlay is a YAML file named after the table it describes. To annotate the
`orders` table, create `overlays/orders.yml`:

```yaml
purpose: >
  Order header. One row per checkout.
rules:
  - Never hard-delete; cancel via the status column.
columns:
  total:
    formula: "SUM(order_items.qty * order_items.price)"
  status:
    meaning: Lifecycle state of the order.
    enum:
      active: Order placed, not yet shipped.
      suspended: Held for review.
```

Point `generate` at the folder:

```bash
dbmlgraph generate -i schema.dbml --overlays overlays -o graph
```

Now `graph/tables/orders.md` carries the purpose as a blurb, lists the rule,
and shows the formula and enum meanings inline.

### What an overlay can hold

Every field is optional. Include only what you have.

| Field | Level | Effect |
|---|---|---|
| `purpose` | table | A one-line blurb shown on the table page and in the index. |
| `rules` | table | A bullet list of business rules under a "Rules" heading. |
| `columns.<name>.meaning` | column | Plain-language description in the "meaning" column. |
| `columns.<name>.generated` | column | Marks the column as derived; rendered as "Generated: …". |
| `columns.<name>.formula` | column | The computation, rendered in a code span. |
| `columns.<name>.enum` | column | Per-value meanings, but only when the column's type is a DBML enum. |

### The rule that governs overlays

**Structure comes from DBML. Overlays only annotate.** An overlay cannot
create a table, a column, a relationship, or an enum value. Name a table that
does not exist and you get error `E001`. Name a missing column and you get
`E002`. Attach `enum:` to a column whose type is not an enum, or list a value
the enum does not declare, and you get `E003`.

These are not warnings you can ignore. `generate`, `export`, and `lint` all
exit with code `1` when any of them fire, so a typo in an overlay fails your
build instead of shipping a wrong page. [Section 6](#6-linting-your-schema)
covers the full list.

---

## 5. How domains are decided

A domain is a group of related tables. dbmlgraph gives each domain its own
page with a Mermaid ER diagram, so the schema reads as a set of connected
areas instead of one flat list.

You have two ways to assign tables to domains. Pick one.

### Option A — DBML TableGroup

DBML has a native grouping construct. Use it and the tool respects it:

```dbml
TableGroup commerce {
  users
  orders
}
```

Both tables now belong to the "commerce" domain.

### Option B — banner comments

When you cannot or do not want to use `TableGroup`, drop a banner comment
above a run of tables. The tool assigns every table below a banner to that
domain, until the next banner:

```dbml
// DOMAIN 1: Identity
Table users { ... }
Table sessions { ... }

// DOMAIN 2: Commerce
Table orders { ... }
Table order_items { ... }
```

The banner format is exact: `// DOMAIN`, a number, a colon, then the name.
`// DOMAIN 1: Identity` works. `// Domain: Identity` does not, and those
tables fall through to "ungrouped".

A `TableGroup` wins over a banner when both apply to the same table. Any table
with no group and no banner above it lands in a domain called "ungrouped".

---

## 6. Linting your schema

`lint` reads your DBML and overlays and reports two severities. Errors block;
warnings inform.

```bash
dbmlgraph lint -i schema.dbml --overlays overlays
```

### Errors (exit code 1)

These come from overlays that disagree with the DBML.

| Code | Means |
|---|---|
| `E001` | Overlay file names a table that the DBML does not declare. |
| `E002` | Overlay names a column the table does not have. |
| `E003` | Overlay attaches `enum:` to a non-enum column, or names an enum value that does not exist. |

### Warnings (exit code 0)

These flag missing documentation. They never block.

| Code | Means |
|---|---|
| `W001` | Table has no `purpose` in any overlay. |
| `W002` | Column has no note (in DBML) and no meaning (in an overlay). |
| `W003` | Enum value has no note and no meaning. |

### Silencing noise on housekeeping columns

Columns like `id`, `created_at`, and `updated_at` need no description. The tool
skips those three by default under `W002`.

The moment you pass `--exclude-columns`, your list **replaces** that default
instead of adding to it. So include the housekeeping names yourself if you
still want them skipped:

```bash
dbmlgraph lint -i schema.dbml \
  --exclude-columns id,created_at,updated_at,tenant_id,version
```

Leave `id,created_at,updated_at` out of your list and they start warning again.

---

## 7. Link styles: Obsidian vs plain markdown

`generate` writes links between pages in one of two styles. Choose with
`--link-style`.

- `--link-style md` (the default) writes standard relative markdown links like
  `[users](tables/users.md)`. Use this for GitHub, static site generators, or
  anything that renders plain markdown.
- `--link-style obsidian` writes wiki-links like `[[users]]`. Use this when the
  output folder lives inside an [Obsidian](https://obsidian.md) vault, so the
  graph view and backlinks light up.

```bash
# For an Obsidian vault:
dbmlgraph generate -i schema.dbml -o my-vault/schema --link-style obsidian
```

The link style changes only the links. Column tables, enums, and ER diagrams
render the same either way.

---

## 8. The RAG export

`export` flattens the whole schema into JSONL, one line per table, ready to
embed and drop into a vector store.

```bash
dbmlgraph export -i schema.dbml --overlays overlays -o schema.jsonl
```

Each line is a self-contained chunk:

```json
{"id":"orders","domain":"commerce","refs_out":["users"],"refs_in":["order_items"],"text":"# orders\n..."}
```

- `id` — the table name, a stable chunk id.
- `domain` — the table's domain slug, useful as a metadata filter.
- `refs_out` / `refs_in` — the tables this one points to and the tables that
  point back, so a retriever can walk relationships.
- `text` — the full rendered table page in plain-markdown link style, the same
  content `generate` puts in `tables/<name>.md`.

Overlays apply here too. Run `export` with `--overlays` and every chunk carries
your business context, so retrieval returns meaning, not just column names.

---

## 9. Behaviors worth knowing

None of these are hidden. They are the choices the tool makes so the output
stays predictable.

- **generate refuses to write outside `--out`.** A crafted table name cannot
  make the tool write to a parent directory. Paths that escape the output folder
  throw before anything is written.
- **generate and export fail on overlay errors, not just lint.** All three
  commands share the same overlay check. An `E001`/`E002`/`E003` from a bad
  overlay exits `1` even during `generate`, so a broken build never ships a
  wrong page.
- **`--exclude-columns` replaces the default, never merges.** Covered in
  [section 6](#6-linting-your-schema). This surprises people, so it is worth
  repeating.
- **Overlays are matched by filename.** `overlays/orders.yml` annotates the
  `orders` table. Both `.yml` and `.yaml` work. The name before the extension
  must match the table name exactly.
- **A `purpose` beats a DBML `Note` for the blurb.** When a table has both a
  DBML `Note` and an overlay `purpose`, the page shows the `purpose`. The `Note`
  is the fallback.
- **Overlay fields are optional and independent.** A file with only a `purpose`
  is valid. A column entry with only a `formula` is valid. Include what you have.
- **Output is deterministic.** Same inputs produce byte-identical output.
  Columns keep DBML order; tables and domains sort by name. You can commit the
  graph and diff it in review.

---

## 10. Full flag reference

### `generate`

| Flag | Required | Default | Meaning |
|---|---|---|---|
| `-i, --input <file>` | yes | — | Path to the DBML file. |
| `-o, --out <dir>` | yes | — | Output directory. Created if missing. |
| `--overlays <dir>` | no | — | Directory of overlay YAML files. |
| `--link-style <style>` | no | `md` | `md` or `obsidian`. |

### `export`

| Flag | Required | Default | Meaning |
|---|---|---|---|
| `-i, --input <file>` | yes | — | Path to the DBML file. |
| `-o, --out <file>` | yes | — | Output JSONL file. |
| `--overlays <dir>` | no | — | Directory of overlay YAML files. |

### `lint`

| Flag | Required | Default | Meaning |
|---|---|---|---|
| `-i, --input <file>` | yes | — | Path to the DBML file. |
| `--overlays <dir>` | no | — | Directory of overlay YAML files. |
| `--exclude-columns <cols>` | no | `id,created_at,updated_at` | Comma-separated columns exempt from `W002`. Replaces the default. |

### Global

| Flag | Meaning |
|---|---|
| `--version` | Print the installed version. |
| `-h, --help` | Print help for the program or a command. |

---

## 11. Troubleshooting

**`DBML parse failed (line N): ...`**
Your DBML has a syntax error at that line. Paste the file into
[dbdiagram.io](https://dbdiagram.io) to see the same error with a visual
pointer.

**`[E001] <table>: overlay for unknown table`**
An overlay file is named after a table the DBML does not declare. Check the
filename against your table names, and check for a typo in either place.

**`[E002] <table>: unknown column '<col>'`**
An overlay lists a column the table does not have. The column names in your
overlay must match the DBML exactly.

**`[E003] <table>: column '<col>' is not an enum`**
You attached `enum:` to a column whose DBML type is not one of your declared
enums. Either change the column's type in the DBML or drop the `enum:` block.

**A table shows up under "ungrouped".**
It has no `TableGroup` and no `// DOMAIN N:` banner above it. See
[section 5](#5-how-domains-are-decided). Check your banner format matches
`// DOMAIN 1: Name` exactly.

**Housekeeping columns started warning under `W002`.**
You passed `--exclude-columns` and left the defaults out. Your list replaces
the default set, so add `id,created_at,updated_at` back if you want them
skipped.

**Wiki-links show as raw `[[text]]` on GitHub.**
You generated with `--link-style obsidian` but are viewing outside Obsidian.
Regenerate with `--link-style md` for GitHub.

---

Still stuck? [Open an issue](https://github.com/verryantopaulus/dbmlgraph/issues)
with a minimal DBML snippet that reproduces it.
