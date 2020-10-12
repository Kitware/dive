import Vue from 'vue';
import Router from 'vue-router';

import girderRest from 'viame-web-common/plugins/girder';
import Viewer from 'viame-web-common/views/TrackViewer/Viewer.vue';
import Home from 'viame-web-common/views/Home.vue';
import Jobs from 'viame-web-common/views/Jobs.vue';
import Login from 'viame-web-common/views/Login.vue';
import Settings from 'viame-web-common/views/Settings.vue';

Vue.use(Router);

function beforeEnter(to, from, next) {
  if (!girderRest.user) {
    next('/login');
  } else {
    next();
  }
}

export default new Router({
  routes: [
    {
      path: '/login',
      name: 'login',
      component: Login,
    },
    {
      path: '/jobs',
      name: 'jobs',
      component: Jobs,
      beforeEnter,
    },
    {
      path: '/settings',
      name: 'settings',
      component: Settings,
      beforeEnter,
    },
    {
      path: '/viewer/:datasetId?',
      name: 'viewer',
      component: Viewer,
      props: true,
      beforeEnter,
    },
    {
      path: '/:_modelType?/:_id?',
      name: 'home',
      component: Home,
      beforeEnter,
    },
  ],
});
