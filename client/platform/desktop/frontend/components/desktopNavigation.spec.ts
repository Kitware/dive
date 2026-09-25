import { desktopDestinations, navigationOverflow } from './desktopNavigation';

it('shows all destinations when they fit and reserves Other when they do not', () => {
  expect(navigationOverflow(desktopDestinations, 1000).hidden).toEqual([]);
  const narrow = navigationOverflow(desktopDestinations, 800);
  expect(narrow.visible).toHaveLength(7);
  expect(narrow.hidden).toHaveLength(3);
  expect(new Set([...narrow.visible, ...narrow.hidden])).toEqual(new Set(desktopDestinations));
});

it('moves Settings into Other at narrow widths', () => {
  const narrow = navigationOverflow(desktopDestinations, 400);
  expect(narrow.visible.map((item) => item.name)).toEqual(['recent', 'pipeline', 'jobs']);
  expect(narrow.hidden.map((item) => item.name)).toEqual(['training', 'models', 'query', 'review', 'scoring', 'addons', 'settings']);
  expect(navigationOverflow(desktopDestinations, 1200).visible).toEqual(desktopDestinations);
});

it('places Models immediately after Training', () => {
  const names = desktopDestinations.map((item) => item.name);
  expect(names[names.indexOf('training') + 1]).toBe('models');
});
