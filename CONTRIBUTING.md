# Contributing to dbmlgraph

Thanks for your interest. dbmlgraph is a small, focused tool — contributions
that keep it small and focused are the most welcome.

## Development setup

```bash
git clone https://github.com/verryantopaulus/dbmlgraph.git
cd dbmlgraph
npm install
npm test          # vitest, watch-free run
npm run build     # tsup → dist/cli.js
npm run dev -- --help   # run the CLI from source without building
```

Requires Node.js >= 20.

## Project layout

The whole tool is a single pass: **DBML text → IR → merge overlays → render**.

| File | Responsibility |
|---|---|
| `src/cli.ts` | Commander wiring for the three commands. No logic. |
| `src/parse.ts` | `@dbml/core` → `IR`. Also resolves domains (TableGroup, or `// DOMAIN N:` banner comments) and relationship cardinality. |
| `src/ir.ts` | The `IR` interfaces — the single in-memory model everything reads. Start here to understand the data. |
| `src/overlay.ts` | Loads + zod-validates overlay YAML, merges business context into the IR, emits `E001`–`E003`. |
| `src/lint.ts` | Structural findings (`W001`–`W003`) plus the passed-through overlay errors. |
| `src/render/` | Pure IR → markdown. `table.ts`, `index.ts`, `domain.ts`, `link.ts`. |
| `src/export.ts` | IR → JSONL, one chunk per table (reuses `renderTable`). |
| `src/generate.ts` | Orchestrates parse → merge → render → write. |

Rule of thumb: **structure comes only from DBML; overlays only annotate.** An
overlay must never be able to invent a table, column, or relationship — if it
refers to something the DBML doesn't declare, that's an error, not a merge.

## Making a change

1. Open an issue first for anything beyond a bug fix or docs — it's cheaper to
   agree on scope before code.
2. Write or update a test. Every `src/` module has a matching
   `test/*.test.ts`; render output is snapshot-tested
   (`test/__snapshots__/`). Update snapshots intentionally with
   `npx vitest -u` and eyeball the diff.
3. Keep the fixture (`test/fixtures/small.dbml` + `test/fixtures/overlays/`)
   generic — no real-world or company-specific schema names.
4. `npm test` and `npm run build` must both pass. CI runs the same on Node 20
   and 22.

## Style

- TypeScript strict mode, ESM, no default exports.
- No new runtime dependency without a clear reason — the dependency list is
  deliberately short (`@dbml/core`, `commander`, `yaml`, `zod`).
- Match the surrounding code: small pure functions, the IR as the single
  source of truth, renderers that only read.

## Adding a lint rule

Add the check in `src/lint.ts`, give it the next code in its severity band
(`E00x` error / `W00x` warning), cover it in `test/lint.test.ts`, and document
the row in the README lint table.

## Adding a new command

Wire it in `src/cli.ts` and put the logic in its own `src/<command>.ts` that
takes the `IR` (or a path) and returns data — keep the command action thin so
the logic stays unit-testable without spawning the CLI.
