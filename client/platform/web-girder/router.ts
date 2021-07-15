import Vue from 'vue';
import Router, { Route } from 'vue-router';

import girderRest from './plugins/girder';
import Home from './views/Home.vue';
import Jobs from './views/Jobs.vue';
import Login from './views/Login.vue';
import RouterPage from './views/RouterPage.vue';
import Summary from './views/Summary.vue';
import ViewerLoader from './views/ViewerLoader.vue';

Vue.use(Router);

function beforeEnter(to: Route, from: Route, next: Function) {
  if (!girderRest.user) {
    next('/login');
  } else {
    next();
  }
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
      props: (route: Route) => ({
        id: route.params.id,
        readonlyMode: !girderRest.user,
      }),
    },
    {
      path: '/',
      name: 'router_base',
      component: RouterPage,
      children: [
        {
          path: 'summary',
          name: 'summary',
          component: Summary,
          beforeEnter,
        },
        {
          path: 'jobs',
          name: 'jobs',
          component: Jobs,
          beforeEnter,
        },
        {
          path: ':_modelType?/:_id?',
          name: 'home',
          component: Home,
          beforeEnter,
        },
      ],
    },
  ],
});

export default router;
