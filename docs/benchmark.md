# Benchmark: context packs vs raw DBML

Can an AI agent write correct SQL from a `dbmlgraph query` context pack, and what does the pack buy over handing it the whole schema? We ran a blind evaluation against a production schema to find out. The two changes shipped in v0.5.0 (`keys:` lines on neighbors, adaptive budget) came directly from round-one failures here.

## Setup

- **Schema:** a production insurance-budgeting schema. 70 tables, 15 domains, overlay coverage on all of them. Table names below are real; nothing else about the source is disclosed.
- **Solver:** Claude Sonnet, fresh session per run, no memory of the product. Each solver got exactly one context file and one SQL task. No repo access, no follow-up questions.
- **Grader:** the schema's author scored each query against ground truth: join paths, exact enum values, business-rule compliance, hallucinated columns.
- **Arms:**
  - **Pack** — output of `dbmlgraph query <tables>` for the task's core tables (4–8k tokens)
  - **Raw** — the full DBML file, all 70 tables (~27k tokens)

Three tasks, easy to hard:

| Task | Shape | What it stresses |
|---|---|---|
| T1 | List forms per cycle for a year | A bridge table the pack shows only as a neighbor |
| T2 | Approved-form count per org unit, zero-inclusive, exact enum values | Enum semantics + a polymorphic join with no declared FK |
| T3 | Sum production per class-of-business within a form's product scope, canonical catalog row | Business rules: partial unique index, XOR data grains, scope config |

## Round 1: v0.5.0 before fixes

All six queries were valid SQL with correct enum literals. The differences were in confidence and coverage.

| Task | Pack | Raw |
|---|---|---|
| T1 | Correct. The solver guessed the bridge table's PK/FK names, since neighbor entries carried no column info. The guess landed, flagged low-confidence. | Correct, columns read directly. |
| T2 | Correct. The solver derived the undeclared polymorphic join from overlay `meaning` text. | Correct, plus a caveat about stale participant rows. |
| T3 | Correct but partial: the budget cut had dropped the neighbor holding an alternate data grain, so the solver excluded it (and said so). | Complete, both grains via UNION ALL. |

Two pack failures, both structural:

1. **Neighbors hid their keys.** A one-line neighbor summary forces the solver to guess join columns on any table it must route through.
2. **The budget cut could drop a direct FK partner.** The truncation label was honest, but losing the only evidence of a second data grain turns "honest" into "confidently incomplete."

## Fixes

- Neighbor entries now carry a `keys:` line by default: PK, each FK with its target, enum-typed columns.
- Budget pressure degrades neighbors to bare summaries before dropping any, and never drops a depth-1 direct-FK neighbor. If the floor doesn't fit, the pack runs over budget and says so.
- The default budget is adaptive: depth-1 renders in full, sized by a probe pass. A hub table with 30 inbound refs no longer degrades on a plain invocation. Pass `--budget <n>` for a hard cap.

## Round 2: after fixes

Fresh solvers, same tasks, regenerated packs.

- **T1:** same correct SQL, but the assumption block now cites the `keys:` line ("confirmed by the Neighbors section") instead of inferring. The guess became a read.
- **T3:** the strongest answer across all runs of this task, both rounds and both arms. The solver included both data grains, then reasoned from the pack's rules that the catalog table needed no join at all for this query — it reviewed the canonical-row rule and correctly judged it inapplicable. The raw-dump solver had joined that table anyway.

## Cost

| Metric | Pack | Raw |
|---|---|---|
| Context size | 4–8k tokens | ~27k tokens |
| Solver session total | 72–78k tokens | 105–115k tokens |
| Tool calls to read context | 1 | up to 16 (offset reads) |

The pack arm matched or beat raw-dump accuracy at 3.5–6x less context. On the hardest task the pack arm won outright: the overlay rules gave the solver grounds to reason about which joins were required, where the raw arm pattern-matched.

One caveat cuts against us: this schema's DBML notes are unusually rich, so the raw arm inherited much of the business context that overlays normally provide. Against a typical bare-DDL schema the pack's advantage should widen.

## Reproducing

The blind protocol is the part worth copying:

1. Pick tasks you know the ground truth for, spanning a single join to a rule-dependent aggregate.
2. Per task, generate a pack (`dbmlgraph query <tables>`) and keep your raw schema file as the control.
3. Give a fresh agent session one file and the task. Forbid other reads. Require the SQL plus a comment block of assumptions and missing context.
4. Grade against ground truth. The assumption blocks are the diagnostic gold: they tell you what the pack failed to say.
