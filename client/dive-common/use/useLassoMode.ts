import {
  onBeforeUnmount, onMounted, readonly, ref,
} from 'vue';

/**
 * Tracks Alt-key lasso mode for UI feedback (EditorMenu) and coordinates with
 * LassoSelectionLayer while the user is drawing.
 */
export function useLassoMode() {
  const lassoModeActive = ref(false);
  const lassoDrawing = ref(false);

  function setLassoDrawing(drawing: boolean) {
    lassoDrawing.value = drawing;
  }

  function onKeyDown(evt: KeyboardEvent) {
    if (evt.altKey) {
      lassoModeActive.value = true;
    }
  }

  function onKeyUp(evt: KeyboardEvent) {
    if (!evt.altKey) {
      lassoModeActive.value = false;
      lassoDrawing.value = false;
    }
  }

  function onBlur() {
    lassoModeActive.value = false;
    lassoDrawing.value = false;
  }

  function installLassoKeyListeners() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  function removeLassoKeyListeners() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  }

  onMounted(installLassoKeyListeners);
  onBeforeUnmount(removeLassoKeyListeners);

  return {
    lassoModeActive: readonly(lassoModeActive),
    lassoDrawing: readonly(lassoDrawing),
    setLassoDrawing,
  };
}

export type LassoModeType = ReturnType<typeof useLassoMode>;
