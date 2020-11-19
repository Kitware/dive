import Vue from 'vue';
import Router from 'vue-router';

import Jobs from './components/Jobs.vue';
import Recent from './components/Recent.vue';
import Settings from './components/Settings.vue';
import ViewerLoader from './components/ViewerLoader.vue';

Vue.use(Router);

export default new Router({
  routes: [
    {
      path: '/recent',
      name: 'recent',
      component: Recent,
    },
    {
      path: '/settings',
      name: 'settings',
      component: Settings,
    },
    {
      path: '/jobs',
      name: 'jobs',
      component: Jobs,
    },
    {
      path: '/viewer/:path',
      name: 'viewer',
      component: ViewerLoader,
      props: true,
    },
    {
      path: '*',
      redirect: '/recent',
    },
  ],
});
