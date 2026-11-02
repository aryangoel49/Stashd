import type { Item } from './types';

/** Which Finder icon stands for an item: a file's own path, the browser for a tab, or the app's name. */
export function iconSource(item: Item): string {
  if (item.kind === 'tab') return item.app === 'Safari' ? '/Applications/Safari.app' : `/Applications/${item.app}.app`;
  if ((item.kind === 'doc' || item.kind === 'folder') && item.path) return item.path;
  return item.app;
}
