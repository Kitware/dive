/** Presentation only: never changes category definitions, selection, or thresholds. */
export interface TypeListViewState {
  compact: boolean;
  collapsed: string[];
}
const STORAGE_KEY = 'dive.typeListViews.v1';
const MAX_VIEWS = 100;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultView(): TypeListViewState { return { compact: true, collapsed: [] }; }
function copy(view: TypeListViewState): TypeListViewState {
  return { compact: view.compact, collapsed: [...view.collapsed] };
}
function browserStorage(): StorageLike | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

export function createTypeListViewStore(storage = browserStorage()) {
  const views = new Map<string, TypeListViewState>();
  let loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const saved: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(saved)) return;
      saved.slice(-MAX_VIEWS).forEach((entry) => {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string') return;
        const [key, view] = entry;
        if (view && typeof view.compact === 'boolean' && Array.isArray(view.collapsed)
          && view.collapsed.length <= 10000 && view.collapsed.every((name: unknown) => typeof name === 'string')) {
          views.set(key, copy(view));
        }
      });
    } catch { /* Storage unavailable or malformed: keep navigation state in memory. */ }
  }
  return {
    read(key: string): TypeListViewState {
      load();
      return copy(views.get(key) ?? defaultView());
    },
    write(key: string, view: TypeListViewState) {
      if (!key) return;
      load();
      views.delete(key);
      views.set(key, copy(view));
      if (views.size > MAX_VIEWS) views.delete(views.keys().next().value!);
      try { storage?.setItem(STORAGE_KEY, JSON.stringify([...views])); } catch { /* Keep the memory copy. */ }
    },
    clear() {
      loaded = true;
      views.clear();
      try { storage?.removeItem(STORAGE_KEY); } catch { /* Storage may be disabled. */ }
    },
  };
}

export const typeListViewStore = createTypeListViewStore();
