#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDbml } from './parse.js';
import { loadOverlays, mergeOverlays } from './overlay.js';
import { lint } from './lint.js';
import { exportJsonl } from './export.js';
import { generate } from './generate.js';

const program = new Command().name('dbmlgraph').description('DBML → LLM-ready markdown knowledge graph');

program.command('generate')
  .requiredOption('-i, --input <file>', 'DBML file')
  .option('--overlays <dir>', 'overlay YAML directory')
  .requiredOption('-o, --out <dir>', 'output directory')
  .option('--link-style <style>', 'obsidian | md', 'md')
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

program.parse();
