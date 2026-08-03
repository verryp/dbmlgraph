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

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

const program = new Command()
  .name('dbmlgraph')
  .description('DBML → LLM-ready markdown knowledge graph')
  .version(pkg.version);

program.command('generate')
  .requiredOption('-i, --input <file>', 'DBML file')
  .option('--overlays <dir>', 'overlay YAML directory')
  .requiredOption('-o, --out <dir>', 'output directory')
  .addOption(new Option('--link-style <style>', 'obsidian | md').choices(['obsidian', 'md']).default('md'))
  .action((o) => {
    const { written, issues } = generate({ input: o.input, overlaysDir: o.overlays, outDir: o.out, linkStyle: o.linkStyle });
    for (const i of issues) console.error(`[${i.code}] ${i.table}: ${i.detail}`);
    console.log(`wrote ${written.length} files to ${o.out}`);
    if (issues.length) process.exit(1);
  });

program.command('lint')
  .requiredOption('-i, --input <file>', 'DBML file')
  .option('--overlays <dir>', 'overlay YAML directory')
  .option('--exclude-columns <cols>', 'comma-separated columns exempt from W002')
  .action((o) => {
    const ir = parseDbml(readFileSync(o.input, 'utf8'));
    const issues = o.overlays ? mergeOverlays(ir, loadOverlays(o.overlays)) : [];
    const res = lint(ir, issues, o.excludeColumns ? { excludeColumns: o.excludeColumns.split(',') } : {});
    for (const e of res.errors) console.error(`ERROR [${e.code}] ${e.table}: ${e.detail}`);
    for (const w of res.warnings) console.warn(`warn  [${w.code}] ${w.table}: ${w.detail}`);
    console.log(`${res.errors.length} errors, ${res.warnings.length} warnings`);
    if (res.errors.length) process.exit(1);
  });

program.command('export')
  .requiredOption('-i, --input <file>', 'DBML file')
  .option('--overlays <dir>', 'overlay YAML directory')
  .requiredOption('-o, --out <file>', 'output jsonl file')
  .action((o) => {
    const ir = parseDbml(readFileSync(o.input, 'utf8'));
    const issues = o.overlays ? mergeOverlays(ir, loadOverlays(o.overlays)) : [];
    for (const i of issues) console.error(`[${i.code}] ${i.table}: ${i.detail}`);
    writeFileSync(o.out, exportJsonl(ir));
    console.log(`wrote ${o.out}`);
    if (issues.length) process.exit(1);
  });

program.command('init')
  .description('scaffold blank overlay YAML stubs from a DBML file (no-clobber)')
  .requiredOption('-i, --input <file>', 'DBML file')
  .requiredOption('-o, --out <dir>', 'overlay output directory')
  .option('--exclude-columns <cols>', 'comma-separated columns to skip in stubs')
  .action((o) => {
    const { written, skipped } = init({ input: o.input, outDir: o.out, excludeColumns: o.excludeColumns ? o.excludeColumns.split(',') : undefined });
    for (const s of skipped) console.error(`skip  ${s} (exists)`);
    console.log(`wrote ${written.length} stubs to ${o.out}${skipped.length ? `, skipped ${skipped.length}` : ''}`);
  });

program.parse();
