# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Gemini, Cursor, etc.)
working in this repo. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md) — this
file assumes you've read it.

## What this tool is

dbmlgraph turns a **DBML schema + optional business-context overlays** into
LLM-ready markdown (a schema index, one page per domain, one page per table)
plus a JSONL export for RAG. It exists so an AI agent can understand a
database's *semantics* — not just its DDL.

## The one invariant

**Structure comes from DBML. Overlays only annotate.** An overlay must never
introduce a table, column, relationship, or enum value. If an overlay
references something the DBML doesn't declare, that is an error
(`E001`/`E002`/`E003`), never a silent merge. Any change that lets an overlay
override structure is wrong by definition — don't make it.

## Mental model (read in this order)

1. `src/ir.ts` — the `IR` interfaces. Everything downstream reads this model. Understand it first.
2. `src/parse.ts` — DBML text → `IR`. Domain resolution + relationship cardinality live here.
3. `src/overlay.ts` — YAML → validated overlay → merged into IR. Emits `E001`–`E003`.
4. `src/render/*` — pure `IR` → markdown. No parsing, no I/O beyond returning strings.
5. `src/{generate,export,lint}.ts` — orchestration. `src/cli.ts` is just Commander wiring.

Data flows one way: **parse → merge → render**. Renderers never reach back
into DBML; they only read the IR.

## Working rules

- **Always add or update a test.** Each `src/` module has a `test/*.test.ts`.
  Render output is snapshot-tested. Run `npm test` before claiming done.
- **Update snapshots deliberately.** `npx vitest -u`, then read the diff — a
  snapshot churn you can't explain is a bug you're about to commit.
- **Keep fixtures generic.** `test/fixtures/` uses `orders`/`users`/`commerce`
  placeholder schemas. Never introduce real company, product, or domain names
  into fixtures, docs, or examples.
- **Don't add runtime dependencies** without strong justification. Current
  set: `@dbml/core`, `commander`, `yaml`, `zod`.
- **Keep the CLI action thin.** Logic goes in a testable `src/<command>.ts`
  that takes the IR (or a path) and returns data; the Commander action just
  calls it and prints.
- **Exit codes are load-bearing.** `lint` and `generate` exit `1` on errors so
  they can gate CI. Don't change exit semantics casually.

## Verify your change

```bash
npm test && npm run build
npm run dev -- generate -i test/fixtures/small.dbml --overlays test/fixtures/overlays -o /tmp/out --link-style md
npm run dev -- lint -i test/fixtures/small.dbml --overlays test/fixtures/overlays
```

`generate` on the fixture should write the index, per-table, and per-domain
files; `lint` on the fixture should report `0 errors`.

## Scope discipline

This is a deliberately small tool. Before adding a feature, check the README
"Roadmap" section — if it's not there and not an issue, open an issue to agree
on scope first. Prefer deleting code to adding it. The best contribution is
often the smallest diff that holds.
