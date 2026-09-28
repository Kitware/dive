// @vitest-environment jsdom
import annotationUndoShortcut from './annotationUndoShortcut';

function press(target: Element, options: KeyboardEventInit = { ctrlKey: true }, enabled = true) {
  const undo = vi.fn();
  const event = new KeyboardEvent('keydown', {
    key: 'z', bubbles: true, cancelable: true, ...options,
  });
  target.addEventListener('keydown', (e) => annotationUndoShortcut(e as KeyboardEvent, undo, enabled), { once: true });
  target.dispatchEvent(event);
  return { undo, event };
}

it.each([{ ctrlKey: true }, { metaKey: true }])('handles the annotation shortcut %j', (options) => {
  const { undo, event } = press(document.createElement('div'), options);
  expect(undo).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
});

it.each(['input', 'textarea', 'select', 'div contenteditable="true"', 'div role="textbox"', 'div role="dialog"'])('preserves native editing in %s', (tag) => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<${tag}></${tag.split(' ')[0]}>`;
  const { undo, event } = press(wrapper.firstElementChild!);
  expect(undo).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

it('does not consume the shortcut when read-only, busy or without history', () => {
  const { undo, event } = press(document.createElement('div'), { ctrlKey: true }, false);
  expect(undo).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

it.each([{ ctrlKey: true, shiftKey: true }, { altKey: true, ctrlKey: true }, {}])('leaves other shortcuts alone %j', (options) => {
  expect(press(document.createElement('div'), options).undo).not.toHaveBeenCalled();
});
