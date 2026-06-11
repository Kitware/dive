/* eslint-disable import/prefer-default-export -- singleton composable store */
import type { GirderModel } from '@girder/components';
import { computed, ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { Router } from 'vue-router';

import girderRest from 'platform/web-girder/plugins/girder';
import { getLocationFromRoute, getRouteFromLocation } from 'platform/web-girder/utils';
import { getFolder } from 'platform/web-girder/api';

import { isGirderModel } from './types';
import type { LocationType } from './types';

let boundRouter: Router | null = null;

/** Call once from main.ts with the app router (avoids circular imports: router → views → useLocation). */
export function bindWebGirderRouter(router: Router): void {
  boundRouter = router;
}

function getRouter(): Router {
  if (!boundRouter) {
    throw new Error('bindWebGirderRouter must be called before using location navigation');
  }
  return boundRouter;
}

const location = ref<LocationType | null>(null);
const selected = ref<GirderModel[]>([]);

export function getUserHomeRoute() {
  if (girderRest.user) {
    return {
      name: 'home' as const,
      params: {
        routeType: 'user',
        routeId: girderRest.user._id,
      },
    };
  }
  return {
    name: 'home' as const,
    params: {
      routeType: 'collections',
    },
  };
}

const defaultRoute = computed(() => getUserHomeRoute());

function getDefaultLocation(): LocationType {
  const fromDefaultRoute = getLocationFromRoute(
    defaultRoute.value as RouteLocationNormalizedLoaded,
  );
  if (fromDefaultRoute === null) {
    throw new Error('Unexpected null default route');
  }
  return fromDefaultRoute;
}

const resolvedLocation = computed(() => location.value ?? getDefaultLocation());

const locationIsViameFolder = computed(() => {
  const loc = location.value;
  if (loc && isGirderModel(loc)) {
    return !!loc?.meta?.annotate;
  }
  return false;
});

const locationRoute = computed(() => getRouteFromLocation(resolvedLocation.value));

export function useLocation() {
  function getLocation(): LocationType | null {
    return location.value;
  }

  function setLocation(value: LocationType | null): void {
    location.value = value;
  }

  function getSelected(): GirderModel[] {
    return selected.value;
  }

  function setSelected(value: GirderModel[]): void {
    selected.value = value;
  }

  async function hydrate(loc: LocationType): Promise<void> {
    if (
      isGirderModel(loc)
      && loc._modelType === 'folder'
      && !loc.name
    ) {
      setLocation((await getFolder(loc._id)).data);
    } else {
      setLocation(loc);
    }
  }

  async function setLocationFromRoute(route: RouteLocationNormalizedLoaded): Promise<void> {
    const newLocation = getLocationFromRoute(route)
      || getLocationFromRoute(defaultRoute.value as RouteLocationNormalizedLoaded);
    if (newLocation === null) {
      throw new Error('Unexpected null default route');
    }
    const current = location.value;
    if (current) {
      if ('type' in current && 'type' in newLocation) {
        if (current.type === newLocation.type) return;
      }
      if ('_id' in current && '_id' in newLocation) {
        if (current._id === newLocation._id) return;
      }
    }
    await hydrate(newLocation);
  }

  async function setRouteFromLocation(loc: LocationType): Promise<void> {
    if (
      isGirderModel(loc)
      && locationIsViameFolder.value
      && loc.name === 'auxiliary'
    ) {
      return;
    }
    getRouter().push(getRouteFromLocation(loc));
    await hydrate(loc);
  }

  return {
    location,
    resolvedLocation,
    selected,
    defaultRoute,
    locationIsViameFolder,
    locationRoute,
    getLocation,
    setLocation,
    getSelected,
    setSelected,
    hydrate,
    setLocationFromRoute,
    setRouteFromLocation,
  };
}
