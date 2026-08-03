#!/usr/bin/env node
import { Command, Option } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDbml } from './parse.js';
import { loadOverlays, mergeOverlays } from './overlay.js';
import { lint } from './lint.js';
import { exportJsonl } from './export.js';
import { generate } from './generate.js';
import { init } from './init.js';
import { loadConfig, pick, require_, ConfigFormatError } from './config.js';

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
    const ir = parseDbml(readFileSync(input, 'utf8'));
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
    const ir = parseDbml(readFileSync(input, 'utf8'));
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

try {
  program.parse();
} catch (e: any) {
  if (e instanceof ConfigFormatError) { console.error(`error: ${e.message}`); process.exit(1); }
  throw e;
}
