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
 *
 * `beforePrompt` runs once unsaved work is detected (e.g. cancel a pending
 * auto-save so it cannot race the user's choice). `onStay` runs when the user
 * cancels the close (e.g. re-arm auto-save).
 */
export function unsavedChangesCloseGuard(options: {
  unsaved: () => boolean;
  save: () => Promise<boolean>;
  beforePrompt?: () => void;
  onStay?: () => void;
}): CloseGuard {
  return async () => {
    if (!options.unsaved()) return true;
    options.beforePrompt?.();
    const choice = await window.diveDesktop.invoke('desktop:confirm-close-unsaved');
    if (choice === 'cancel') {
      options.onStay?.();
      return false;
    }
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
