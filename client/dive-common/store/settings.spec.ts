// @vitest-environment jsdom
/// <reference types="vitest" />

describe('clientSettings hydration', () => {
  it('keeps every type-list switch a reactive key when nothing is stored', async () => {
    localStorage.removeItem('Settings');
    vi.resetModules();

    const { clientSettings } = await import('./settings');

    expect(Object.keys(clientSettings.typeSettings)).toEqual(expect.arrayContaining([
      'showTotalCount', 'showFrameCount',
    ]));
    expect(clientSettings.typeSettings.showTotalCount).toBe(true);
    expect(clientSettings.typeSettings.showFrameCount).toBe(true);
  });

  it('hydrates count switches on unless a stored blob turned one off', async () => {
    localStorage.setItem('Settings', JSON.stringify({
      typeSettings: { trackSortDir: 'count', showTotalCount: false },
    }));
    vi.resetModules();

    const { clientSettings } = await import('./settings');

    expect(clientSettings.typeSettings.showTotalCount).toBe(false);
    expect(clientSettings.typeSettings.showFrameCount).toBe(true);
    expect(clientSettings.typeSettings.trackSortDir).toBe('count');
  });
});
