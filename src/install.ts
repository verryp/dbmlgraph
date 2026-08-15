import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export class InstallError extends Error {}

export const MARKER_START = '<!-- dbmlgraph:start -->';
export const MARKER_END = '<!-- dbmlgraph:end -->';

/**
 * Explicit dir must contain .dbmlgraph.yml. Without one, walk up from cwd
 * (git-style) until a .dbmlgraph.yml appears.
 */
export function resolveSchemaDir(explicit: string | undefined, cwd: string): string {
  if (explicit) {
    const dir = resolve(cwd, explicit);
    if (!existsSync(join(dir, '.dbmlgraph.yml'))) {
      throw new InstallError(`no .dbmlgraph.yml in ${dir}`);
    }
    return dir;
  }
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.dbmlgraph.yml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new InstallError('missing schema dir: pass --schema-dir <dir containing .dbmlgraph.yml>');
}

/** Shared usage guidance — the skill body and the AGENTS.md section render from this. */
function usageBody(schemaDir: string): string {
  return `Schema source: \`${schemaDir}\` (contains \`.dbmlgraph.yml\`). Run all commands from that directory:

\`\`\`bash
cd "${schemaDir}"
\`\`\`

**Locate an identifier** (wide, cheap — "which tables have column X", impact scans, enum sweeps):

\`\`\`bash
dbmlgraph find <term>              # table, column, enum, enum value, domain — kind auto-detected
dbmlgraph find "ratio_*"           # glob
dbmlgraph find <term> --format json
\`\`\`

**Full context for a table** (deep — structure, relationships, business meaning):

\`\`\`bash
dbmlgraph query <table>
dbmlgraph query <table> --columns key   # slimmer neighbors for hub tables
\`\`\`

\`find\` locates; \`query\` explains. Start with \`find\` when unsure of the exact name. Prefer these over grepping schema markdown.`;
}

export function skillTemplate(schemaDir: string): string {
  return `---
name: dbmlgraph
description: Schema lookup for this project's database. Use when asked about table structure, columns, relationships, enums, which tables carry a field, or before writing SQL against the schema.
---

# dbmlgraph — schema knowledge graph

${usageBody(schemaDir)}
`;
}

export function agentsSection(schemaDir: string): string {
  return `${MARKER_START}
## Database schema lookup (dbmlgraph)

${usageBody(schemaDir)}
${MARKER_END}`;
}

export function installClaude(o: { schemaDir: string; cwd: string; global?: boolean; homeDir?: string }): string {
  const base = o.global
    ? join(o.homeDir ?? homedir(), '.claude', 'skills', 'dbmlgraph')
    : join(o.cwd, '.claude', 'skills', 'dbmlgraph');
  mkdirSync(base, { recursive: true });
  const file = join(base, 'SKILL.md');
  writeFileSync(file, skillTemplate(o.schemaDir));
  return file;
}
