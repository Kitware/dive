describe('clientSettings hydration', () => {
  it('keeps every type-list switch a reactive key when nothing is stored', async () => {
    localStorage.removeItem('Settings');
    vi.resetModules();

    const { clientSettings } = await import('./settings');

    expect(Object.keys(clientSettings.typeSettings)).toEqual(expect.arrayContaining([
      'showTotalCount', 'showFrameCount', 'filterTypesByFrame',
    ]));
    expect(clientSettings.typeSettings.showTotalCount).toBe(true);
    expect(clientSettings.typeSettings.showFrameCount).toBe(true);
    expect(clientSettings.typeSettings.filterTypesByFrame).toBe(false);
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

it('starts each sequence with sequence-wide type rows even after frame-only filtering', async () => {
  const { effectScope, ref } = await import('vue');
  const { default: setup, clientSettings } = await import('./settings');
  clientSettings.typeSettings.filterTypesByFrame = true;
  const scope = effectScope();
  scope.run(() => setup(ref(['fish', 'shark'])));
  expect(clientSettings.typeSettings.filterTypesByFrame).toBe(false);
  // Frame-only filtering remains available as an explicit choice in the current sequence.
  clientSettings.typeSettings.filterTypesByFrame = true;
  expect(clientSettings.typeSettings.filterTypesByFrame).toBe(true);
  scope.stop();
});
