// @vitest-environment jsdom
/// <reference types="vitest" />

describe('clientSettings hydration', () => {
  it('keeps every type-list switch a reactive key when nothing is stored', async () => {
    localStorage.removeItem('Settings');
    vi.resetModules();

    const { clientSettings } = await import('./settings');

    expect(Object.keys(clientSettings.typeSettings)).toEqual(expect.arrayContaining([
      'filterTypesByFrame',
    ]));
    expect(clientSettings.typeSettings.filterTypesByFrame).toBe(false);
  });
});
