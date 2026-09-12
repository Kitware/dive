export interface DesktopDestination {
  name: string;
  label: string;
  icon: string;
  params?: Record<string, string>;
  title?: string;
}

export const desktopDestinations: DesktopDestination[] = [
  { name: 'recent', label: 'Library', icon: 'mdi-folder-open' },
  { name: 'pipeline', label: 'Pipelines', icon: 'mdi-pipe' },
  { name: 'jobs', label: 'Jobs', icon: 'mdi-format-list-checks' },
  { name: 'training', label: 'Training', icon: 'mdi-brain' },
  { name: 'query', label: 'Query', icon: 'mdi-image-search-outline' },
  { name: 'review', label: 'Review', icon: 'mdi-view-grid-outline' },
  { name: 'scoring', label: 'Scoring', icon: 'mdi-chart-box-outline' },
  { name: 'addons', label: 'Add-Ons', icon: 'mdi-puzzle' },
  { name: 'settings', label: 'Settings', icon: 'mdi-cog' },
];
export const primaryDestinations = ['recent', 'jobs', 'settings'];
export const annotationPrimaryDestinations = ['recent', 'jobs', 'review', 'settings'];

/** Reserve the Other button before choosing which secondary tabs fit. */
export function navigationOverflow(items: DesktopDestination[], width: number) {
  const slots = Math.max(4, Math.floor(width / 100));
  if (items.length <= slots) return { visible: items, hidden: [] };
  const primary = items.filter((item) => primaryDestinations.includes(item.name));
  const secondary = items.filter((item) => !primaryDestinations.includes(item.name));
  const visible = new Set([...primary, ...secondary.slice(0, Math.max(0, slots - primary.length - 1))]);
  return { visible: items.filter((item) => visible.has(item)), hidden: items.filter((item) => !visible.has(item)) };
}
