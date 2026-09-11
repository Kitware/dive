import { desktopDestinations, navigationOverflow } from './desktopNavigation';

it('shows all destinations when they fit and reserves Other when they do not', () => {
  expect(navigationOverflow(desktopDestinations, 900).hidden).toEqual([]);
  const narrow = navigationOverflow(desktopDestinations, 800);
  expect(narrow.visible).toHaveLength(7);
  expect(narrow.hidden).toHaveLength(2);
  expect(new Set([...narrow.visible, ...narrow.hidden])).toEqual(new Set(desktopDestinations));
});

it('keeps Library, Jobs and Settings visible at narrow widths', () => {
  const narrow = navigationOverflow(desktopDestinations, 400);
  expect(narrow.visible.map((item) => item.name)).toEqual(['recent', 'jobs', 'settings']);
  expect(narrow.hidden.map((item) => item.name)).toEqual(['pipeline', 'training', 'query', 'review', 'scoring', 'addons']);
  expect(navigationOverflow(desktopDestinations, 1200).visible).toEqual(desktopDestinations);
});
