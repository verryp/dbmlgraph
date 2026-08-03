# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-08-03

### Added
- Config file (`.dbmlgraph.yml`): set `input`, `overlays`, `out`, `linkStyle`,
  `excludeColumns` once and run `generate`/`lint`/`export`/`init` with no flags.
  Explicit flags override the config; `-c/--config <path>` points at a custom
  file. A missing default file is fine (config is optional); a missing explicit
  `--config` path is an error.

### Changed
- `generate`/`lint`/`export`/`init` no longer require `-i`/`-o` flags when the
  values are supplied by a config file. Invocations that passed the flags
  explicitly are unaffected.

## [0.2.0] - 2026-08-03

### Added
- `init` command: scaffold blank, correctly-keyed overlay YAML stubs from a DBML
  file — one stub per table with every column and enum value pre-listed
  (meanings blank). No-clobber: existing overlay files are skipped and reported.
  `id`/`created_at`/`updated_at` omitted by default (`--exclude-columns` to override).

## [0.1.1] - 2026-08-02

### Fixed

- Corrected the repository, homepage, and issue URLs to the actual GitHub owner
  (`verryp`). No code or behavior change.

## [0.1.0] - 2026-08-02

### Added

- `generate` — DBML + overlays → markdown knowledge graph (schema index,
  per-domain pages, per-table pages) with `md` or `obsidian` link styles.
- `export` — DBML + overlays → JSONL, one chunk per table, for RAG pipelines.
- `lint` — structural checks over DBML + overlays (`E001`–`E003` errors,
  `W001`–`W003` warnings) with `--exclude-columns` and CI-gating exit codes.
- Overlay layer: per-table YAML carrying `purpose`, `rules`, and per-column
  `meaning` / `generated` / `formula` / `enum` semantics.
- Domain resolution from DBML `TableGroup` or `// DOMAIN N:` banner comments.

[Unreleased]: https://github.com/verryp/dbmlgraph/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/verryp/dbmlgraph/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/verryp/dbmlgraph/releases/tag/v0.1.0
