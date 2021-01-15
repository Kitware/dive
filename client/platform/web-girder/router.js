import Vue from 'vue';
import Router from 'vue-router';

import girderRest from './plugins/girder';
import Home from './views/Home.vue';
import Jobs from './views/Jobs.vue';
import Login from './views/Login.vue';
import RouterPage from './views/RouterPage.vue';
import Settings from './views/Settings.vue';
import ViewerLoader from './views/ViewerLoader.vue';

Vue.use(Router);

function beforeEnter(to, from, next) {
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
      props: true,
      beforeEnter,
    },
    {
      path: '/',
      name: 'router_base',
      component: RouterPage,
      children: [
        {
          path: 'settings',
          name: 'settings',
          component: Settings,
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
