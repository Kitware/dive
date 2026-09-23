// @vitest-environment jsdom
import { runCloseGuard, setCloseGuard, unsavedChangesCloseGuard } from './closeGuard';

let choice: 'save' | 'discard' | 'cancel';
const invoke = vi.fn(async () => choice);
beforeEach(() => {
  Object.defineProperty(window, 'diveDesktop', { configurable: true, value: { invoke, send: vi.fn() } });
  invoke.mockClear();
});
afterEach(() => setCloseGuard(null));

it('lets the window close without asking when nothing is unsaved', async () => {
  const save = vi.fn(async () => true);
  setCloseGuard(unsavedChangesCloseGuard({ unsaved: () => false, save }));
  expect(await runCloseGuard()).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it('offers the native prompt for unsaved edits and follows the choice', async () => {
  const save = vi.fn(async () => true);
  setCloseGuard(unsavedChangesCloseGuard({ unsaved: () => true, save }));
  choice = 'cancel';
  expect(await runCloseGuard()).toBe(false);
  expect(invoke).toHaveBeenCalledWith('desktop:confirm-close-unsaved');
  choice = 'discard';
  expect(await runCloseGuard()).toBe(true);
  expect(save).not.toHaveBeenCalled();
  choice = 'save';
  expect(await runCloseGuard()).toBe(true);
  expect(save).toHaveBeenCalledOnce();
});

it('keeps the window open when saving fails', async () => {
  choice = 'save';
  setCloseGuard(unsavedChangesCloseGuard({ unsaved: () => true, save: async () => false }));
  expect(await runCloseGuard()).toBe(false);
  setCloseGuard(unsavedChangesCloseGuard({ unsaved: () => true, save: async () => { throw new Error('disk full'); } }));
  expect(await runCloseGuard()).toBe(false);
});
