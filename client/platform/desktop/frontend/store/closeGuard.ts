import { onBeforeUnmount, onMounted } from 'vue';

type CloseGuard = () => Promise<boolean>;

let closeGuard: CloseGuard | null = null;

export function setCloseGuard(guard: CloseGuard | null) {
  closeGuard = guard;
}

export async function runCloseGuard(): Promise<boolean> {
  if (closeGuard) {
    return closeGuard();
  }
  return true;
}

/**
 * A guard for a page with unsaved edits: the native three-way prompt decides
 * whether the window closes, saving first when asked. `save` resolves false
 * when the edits could not be saved, which keeps the window open. A page's
 * `beforeunload` handler cannot do this: Electron cancels the close silently
 * when one sets returnValue, so nothing at all appears to happen.
 */
export function unsavedChangesCloseGuard(options: {
  unsaved: () => boolean;
  save: () => Promise<boolean>;
}): CloseGuard {
  return async () => {
    if (!options.unsaved()) return true;
    const choice = await window.diveDesktop.invoke('desktop:confirm-close-unsaved');
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      try {
        return await options.save();
      } catch {
        return false;
      }
    }
    return true;
  };
}

/** Make `guard` answer the window's close button while the calling page is mounted. */
export function useDesktopCloseGuard(guard: CloseGuard) {
  onMounted(() => {
    setCloseGuard(guard);
    window.diveDesktop.send('desktop:close-guard-active', true);
  });
  onBeforeUnmount(() => {
    setCloseGuard(null);
    window.diveDesktop.send('desktop:close-guard-active', false);
  });
}
