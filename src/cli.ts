#!/usr/bin/env node
import { Command, Option } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbmlFile, DbmlParseError } from './parse.js';
import { loadOverlays, mergeOverlays } from './overlay.js';
import { lint } from './lint.js';
import { exportJsonl } from './export.js';
import { generate } from './generate.js';
import { init } from './init.js';
import { query, QueryResolveError, MAX_DEPTH, DEFAULT_DEPTH, DEFAULT_BUDGET } from './query.js';
import { find } from './find.js';
import { loadConfig, pick, require_, ConfigFormatError } from './config.js';
import { installClaude, installAgents, uninstall, installStatus, resolveSchemaDir, InstallError } from './install.js';

// comma-string flag → array, matching config's excludeColumns shape
const asCols = (v: string | undefined): string[] | undefined => v?.split(',');

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

const program = new Command()
  .name('dbmlgraph')
  .description('DBML → LLM-ready markdown knowledge graph')
  .version(pkg.version);

program.command('generate')
  .option('-i, --input <file>', 'DBML file')
  .option('--overlays <dir>', 'overlay YAML directory')
  .option('-o, --out <dir>', 'output directory')
  .addOption(new Option('--link-style <style>', 'obsidian | md').choices(['obsidian', 'md']))
  .option('-c, --config <file>', 'config file (default .dbmlgraph.yml)')
  .action((o) => {
    const cfg = loadConfig(o.config);
    const input = require_(pick(o.input, cfg.input), 'input');
    const out = require_(pick(o.out, cfg.out), 'out');
    const overlaysDir = pick(o.overlays, cfg.overlays);
    const linkStyle = pick(o.linkStyle, cfg.linkStyle, 'md');
    const { written, issues } = generate({ input, overlaysDir, outDir: out, linkStyle });
    for (const i of issues) console.error(`[${i.code}] ${i.table}: ${i.detail}`);
    console.log(`wrote ${written.length} files to ${out}`);
    if (issues.length) process.exit(1);
  });

program.command('lint')
  .option('-i, --input <file>', 'DBML file')
  .option('--overlays <dir>', 'overlay YAML directory')
  .option('--exclude-columns <cols>', 'comma-separated columns exempt from W002')
  .option('-c, --config <file>', 'config file (default .dbmlgraph.yml)')
  .action((o) => {
    const cfg = loadConfig(o.config);
    const input = require_(pick(o.input, cfg.input), 'input');
    const overlays = pick(o.overlays, cfg.overlays);
    const excludeColumns = pick(asCols(o.excludeColumns), cfg.excludeColumns);
    const ir = parseDbmlFile(input);
    const issues = overlays ? mergeOverlays(ir, loadOverlays(overlays)) : [];
    const res = lint(ir, issues, excludeColumns ? { excludeColumns } : {});
    for (const e of res.errors) console.error(`ERROR [${e.code}] ${e.table}: ${e.detail}`);
    for (const w of res.warnings) console.warn(`warn  [${w.code}] ${w.table}: ${w.detail}`);
    console.log(`${res.errors.length} errors, ${res.warnings.length} warnings`);
    if (res.errors.length) process.exit(1);
  });

program.command('export')
  .option('-i, --input <file>', 'DBML file')
  .option('--overlays <dir>', 'overlay YAML directory')
  .option('-o, --out <file>', 'output jsonl file')
  .option('-c, --config <file>', 'config file (default .dbmlgraph.yml)')
  .action((o) => {
    const cfg = loadConfig(o.config);
    const input = require_(pick(o.input, cfg.input), 'input');
    const out = require_(pick(o.out, cfg.out), 'out');
    const overlays = pick(o.overlays, cfg.overlays);
    const ir = parseDbmlFile(input);
    const issues = overlays ? mergeOverlays(ir, loadOverlays(overlays)) : [];
    for (const i of issues) console.error(`[${i.code}] ${i.table}: ${i.detail}`);
    writeFileSync(out, exportJsonl(ir));
    console.log(`wrote ${out}`);
    if (issues.length) process.exit(1);
  });

program.command('init')
  .description('scaffold blank overlay YAML stubs from a DBML file (no-clobber)')
  .option('-i, --input <file>', 'DBML file')
  .option('-o, --out <dir>', 'overlay output directory')
  .option('--exclude-columns <cols>', 'comma-separated columns to skip in stubs')
  .option('-c, --config <file>', 'config file (default .dbmlgraph.yml)')
  .action((o) => {
    const cfg = loadConfig(o.config);
    const input = require_(pick(o.input, cfg.input), 'input');
    // init writes stubs into the overlays dir → config's `overlays`, not `out`
    const out = require_(pick(o.out, cfg.overlays), 'out');
    const excludeColumns = pick(asCols(o.excludeColumns), cfg.excludeColumns);
    const { written, skipped } = init({ input, outDir: out, excludeColumns });
    for (const s of skipped) console.error(`skip  ${s} (exists)`);
    console.log(`wrote ${written.length} stubs to ${out}${skipped.length ? `, skipped ${skipped.length}` : ''}`);
  });

program.command('query')
  .description('print an LLM context pack for one or more tables')
  .argument('<table...>', 'table names to expand')
  .option('-i, --input <file>', 'DBML file')
  .option('--overlays <dir>', 'overlay YAML directory')
  .option('--depth <n>', `neighbor hops, max ${MAX_DEPTH} (default ${DEFAULT_DEPTH})`)
  .option('--budget <tokens>', `approx token budget (default: adaptive, min ${DEFAULT_BUDGET})`)
  .addOption(new Option('--columns <mode>', 'neighbor column detail: key | all').choices(['key', 'all']))
  .addOption(new Option('--format <fmt>', 'md | json').choices(['md', 'json']))
  .option('--strict', 'exact table names only, no fuzzy match')
  .option('-c, --config <file>', 'config file (default .dbmlgraph.yml)')
  .action((tables: string[], o) => {
    const cfg = loadConfig(o.config);
    const input = require_(pick(o.input, cfg.input), 'input');
    const overlays = pick(o.overlays, cfg.overlays);
    const ir = parseDbmlFile(input);
    if (overlays) mergeOverlays(ir, loadOverlays(overlays));
    console.log(query(ir, {
      tables,
      depth: o.depth != null ? Number(o.depth) : undefined,
      budget: o.budget != null ? Number(o.budget) : undefined,
      columns: o.columns,
      format: o.format,
      strict: !!o.strict,
    }));
  });

program.command('find')
  .description('locate identifiers — tables, columns, enums, enum values, domains — across the schema')
  .argument('<term...>', 'identifier names or globs (e.g. cycle_id, "ratio_*")')
  .option('-i, --input <file>', 'DBML file')
  .option('--overlays <dir>', 'overlay YAML directory')
  .addOption(new Option('--format <fmt>', 'md | json').choices(['md', 'json']))
  .option('--strict', 'exact + glob only, no fuzzy match')
  .option('-c, --config <file>', 'config file (default .dbmlgraph.yml)')
  .action((terms: string[], o) => {
    const cfg = loadConfig(o.config);
    const input = require_(pick(o.input, cfg.input), 'input');
    const overlays = pick(o.overlays, cfg.overlays);
    const ir = parseDbmlFile(input);
    if (overlays) mergeOverlays(ir, loadOverlays(overlays));
    console.log(find(ir, { terms, format: o.format, strict: !!o.strict }));
  });

program.command('install')
  .description('install AI-agent integration (claude | agents)')
  .argument('[agent]', 'claude | agents')
  .option('--schema-dir <path>', 'directory containing .dbmlgraph.yml (default: walk up from cwd)')
  .option('--global', 'claude only: install to ~/.claude/skills instead of ./.claude/skills')
  .option('--list', 'show install status for all targets')
  .action((agent: string | undefined, o) => {
    if (o.list) {
      const s = installStatus({ cwd: process.cwd() });
      console.log(`claude ${s.claude ? 'installed' : 'not installed'}${s.claudeGlobal ? ' (global installed)' : ''}`);
      console.log(`agents ${s.agents ? 'installed' : 'not installed'}`);
      return;
    }
    if (agent !== 'claude' && agent !== 'agents') {
      throw new InstallError(`unknown agent "${agent ?? ''}": expected claude | agents`);
    }
    const schemaDir = resolveSchemaDir(o.schemaDir, process.cwd());
    const file = agent === 'claude'
      ? installClaude({ schemaDir, cwd: process.cwd(), global: !!o.global })
      : installAgents({ schemaDir, cwd: process.cwd() });
    console.log(`wrote ${file}\nschema dir baked: ${schemaDir}`);
  });

program.command('uninstall')
  .description('remove AI-agent integration (claude | agents)')
  .argument('<agent>', 'claude | agents')
  .option('--global', 'claude only: remove from ~/.claude/skills instead of ./.claude/skills')
  .action((agent: string, o) => {
    if (agent !== 'claude' && agent !== 'agents') {
      throw new InstallError(`unknown agent "${agent}": expected claude | agents`);
    }
    const removed = uninstall(agent, { cwd: process.cwd(), global: !!o.global });
    console.log(removed ? `removed ${removed}` : 'nothing installed');
  });

try {
  program.parse();
} catch (e: any) {
  if (e instanceof ConfigFormatError) { console.error(`error: ${e.message}`); process.exit(1); }
  if (e instanceof QueryResolveError) { console.error(e.message); process.exit(1); }
  if (e instanceof InstallError) { console.error(`error: ${e.message}`); process.exit(1); }
  if (e instanceof DbmlParseError) {
    const loc = [e.file, e.line != null ? `line ${e.line}` : null].filter(Boolean).join(', ');
    const hint = e.markdownNoFence ? ' — input looks like markdown without a ```dbml fence?' : '';
    console.error(`dbml parse failed (${loc}): ${e.detail}${hint}`);
    process.exit(1);
  }
  throw e;
}
