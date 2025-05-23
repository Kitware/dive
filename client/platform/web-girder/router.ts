import Vue from 'vue';
import Router, { Route } from 'vue-router';

import girderRest from './plugins/girder';
import Home from './views/Home.vue';
import Jobs from './views/Jobs.vue';
import TrainedModels from './views/TrainedModels.vue';
import Login from './views/Login.vue';
import RouterPage from './views/RouterPage.vue';
import AdminPage from './views/AdminPage.vue';
import ViewerLoader from './views/ViewerLoader.vue';
import DataShared from './views/DataShared.vue';
import DataBrowser from './views/DataBrowser.vue';
import Summary from './views/Summary.vue';

Vue.use(Router);

// eslint-disable-next-line @typescript-eslint/ban-types
function beforeEnter(to: Route, from: Route, next: Function) {
  if (!girderRest.user) {
    next('/login');
  } else {
    next();
  }
}

// eslint-disable-next-line @typescript-eslint/ban-types
function adminGuard(to: Route, from: Route, next: Function) {
  if (!girderRest.user.admin) {
    next('/');
  } else {
    next();
  }
}

function toArray(data: string | (string | null)[]) {
  if (data && typeof data === 'string') {
    return [data];
  }
  return data;
}

const router = new Router({
  routes: [
    {
      path: '/login',
      name: 'login',
      component: Login,
    },
    {
      path: '/viewer/:id',
      name: 'viewer',
      component: ViewerLoader,
      props: (route) => ({ ...route.params, comparisonSets: toArray(route.query.comparisonSets) }),
      beforeEnter,
    },
    {
      path: '/viewer/:id/set/:set',
      name: 'set viewer',
      component: ViewerLoader,
      props: (route) => ({ ...route.params, comparisonSets: toArray(route.query.comparisonSets) }),
      beforeEnter,
    },
    {
      path: '/viewer/:id/revision/:revision',
      name: 'revision viewer',
      component: ViewerLoader,
      props: true,
      beforeEnter,
    },
    {
      path: '/viewer/:id/set/:set/revision/:revision',
      name: 'revision set viewer',
      component: ViewerLoader,
      props: true,
      beforeEnter,
    },
    {
      path: '/',
      component: RouterPage,
      children: [
        {
          path: '/admin',
          name: 'admin',
          component: AdminPage,
          props: true,
          beforeEnter: adminGuard,
        },
        {
          path: 'jobs',
          name: 'jobs',
          component: Jobs,
          beforeEnter,
        },
        {
          path: 'trained-models',
          name: 'trained-models',
          component: TrainedModels,
          beforeEnter,
        },
        {
          path: '',
          component: Home,
          children: [
            {
              path: 'shared',
              name: 'shared',
              component: DataShared,
              beforeEnter,
            },
            {
              path: 'summary',
              name: 'summary',
              component: Summary,
              beforeEnter,
            },
            {
              path: ':routeType?/:routeId?',
              name: 'home',
              component: DataBrowser,
              beforeEnter,
            },
          ],
        },
      ],
    },
  ],
});

export default router;
