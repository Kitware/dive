/* eslint-disable import/prefer-default-export -- singleton composable store */
import type { GirderModel } from '@girder/components';
import { computed, ref } from 'vue';
import type { Route } from 'vue-router';
import type VueRouter from 'vue-router';

import girderRest from 'platform/web-girder/plugins/girder';
import { getLocationFromRoute, getRouteFromLocation } from 'platform/web-girder/utils';
import { getFolder } from 'platform/web-girder/api';

import { isGirderModel } from './types';
import type { LocationType } from './types';

let boundRouter: VueRouter | null = null;

/** Call once from main.ts with the app router (avoids circular imports: router → views → useLocation). */
export function bindWebGirderRouter(router: VueRouter): void {
  boundRouter = router;
}

function getRouter(): VueRouter {
  if (!boundRouter) {
    throw new Error('bindWebGirderRouter must be called before using location navigation');
  }
  return boundRouter;
}

const location = ref<LocationType | null>(null);
const selected = ref<GirderModel[]>([]);

function getDefaultHomeRouteParams(): { routeType: string; routeId?: string } {
  if (girderRest.user) {
    return {
      routeId: girderRest.user._id,
      routeType: 'user',
    };
  }
  return {
    routeType: 'collections',
  };
}

function getDefaultHomeRoutePath(): string {
  const params = getDefaultHomeRouteParams();
  if (params.routeId) {
    return `/${params.routeType}/${params.routeId}`;
  }
  return `/${params.routeType}`;
}

const defaultRoute = computed(() => ({
  name: 'home',
  params: getDefaultHomeRouteParams(),
}));

const locationIsViameFolder = computed(() => {
  const loc = location.value;
  if (loc && isGirderModel(loc)) {
    return !!loc?.meta?.annotate;
  }
  return false;
});

const locationRoute = computed(() => {
  if (location.value) {
    return getRouteFromLocation(location.value);
  }
  return getDefaultHomeRoutePath();
});

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

  async function setLocationFromRoute(route: Route): Promise<void> {
    const newLocation = getLocationFromRoute(route) || getLocationFromRoute(defaultRoute.value as Route);
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
