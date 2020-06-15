import Vue from 'vue';
import Router from 'vue-router';

import girderRest from '@/plugins/girder';
import Viewer from '@/views/TrackViewer/Viewer.vue';
import Home from '@/views/Home.vue';
import Jobs from '@/views/Jobs.vue';
import Login from '@/views/Login.vue';
import Settings from '@/views/Settings.vue';

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
