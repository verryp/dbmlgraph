export type LinkStyle = 'obsidian' | 'md';

/** link to a TABLE node from a file living in `fromDir` */
export function link(name: string, style: LinkStyle, fromDir: 'root' | 'tables' | 'domains'): string {
  if (style === 'obsidian') return `[[${name}]]`;
  const prefix = fromDir === 'tables' ? '' : fromDir === 'domains' ? '../tables/' : 'tables/';
  return `[${name}](${prefix}${name}.md)`;
}
