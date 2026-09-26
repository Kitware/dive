/** Keep native text undo and dialog shortcuts separate from annotation undo. */
export default function annotationUndoShortcut(event: KeyboardEvent, undo: () => void, enabled: boolean) {
  if (!enabled || event.defaultPrevented || event.altKey || event.shiftKey
    || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
  const { target } = event;
  if (target instanceof Element && target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]',
  )) return;
  if (document.querySelector('.v-dialog--active')) return;
  event.preventDefault();
  undo();
}
