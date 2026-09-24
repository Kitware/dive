import { runCloseGuard, setCloseGuard, unsavedChangesCloseGuard } from './closeGuard';

let choice: 'save' | 'discard' | 'cancel';
const invoke = vi.fn(async () => choice);
beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { diveDesktop: { invoke, send: vi.fn() } },
  });
  invoke.mockClear();
});
afterEach(() => setCloseGuard(null));

it('lets the window close without asking when nothing is unsaved', async () => {
  const save = vi.fn(async () => true);
  const beforePrompt = vi.fn();
  setCloseGuard(unsavedChangesCloseGuard({ unsaved: () => false, save, beforePrompt }));
  expect(await runCloseGuard()).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(beforePrompt).not.toHaveBeenCalled();
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

it('cancels a pending auto-save before the prompt and re-arms it on stay', async () => {
  const save = vi.fn(async () => true);
  const beforePrompt = vi.fn();
  const onStay = vi.fn();
  setCloseGuard(unsavedChangesCloseGuard({
    unsaved: () => true, save, beforePrompt, onStay,
  }));
  choice = 'cancel';
  expect(await runCloseGuard()).toBe(false);
  expect(beforePrompt).toHaveBeenCalledOnce();
  expect(onStay).toHaveBeenCalledOnce();
  beforePrompt.mockClear();
  onStay.mockClear();
  choice = 'discard';
  expect(await runCloseGuard()).toBe(true);
  expect(beforePrompt).toHaveBeenCalledOnce();
  expect(onStay).not.toHaveBeenCalled();
});

it('keeps the window open when saving fails', async () => {
  choice = 'save';
  setCloseGuard(unsavedChangesCloseGuard({ unsaved: () => true, save: async () => false }));
  expect(await runCloseGuard()).toBe(false);
  setCloseGuard(unsavedChangesCloseGuard({ unsaved: () => true, save: async () => { throw new Error('disk full'); } }));
  expect(await runCloseGuard()).toBe(false);
});
