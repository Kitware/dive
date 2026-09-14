import router from '../router';
import { reportHandledPromiseRejection } from '../reportHandledPromiseRejection';
import { useLocation } from './useLocation';
import { initJobs } from './useJobs';

router.beforeEach((to, from, next) => {
  if (to.name === 'home') {
    useLocation().setLocationFromRoute(to).catch((reason) => {
      reportHandledPromiseRejection('router: setLocationFromRoute (home)', reason);
    });
  }
  next();
});

initJobs().catch((reason) => {
  reportHandledPromiseRejection('initJobs', reason);
});

export { useBrand } from './useBrand';
export { useConfig } from './useConfig';
export type { ConfigState } from './useConfig';
export { useDataset } from './useDataset';
export { useJobs, initJobs } from './useJobs';
export { useLocation, bindWebGirderRouter } from './useLocation';
export { useUser } from './useUser';
export * from './types';
