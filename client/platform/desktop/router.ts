import Vue from 'vue';
import Router from 'vue-router';

import Jobs from './frontend/components/Jobs.vue';
import Recent from './frontend/components/Recent.vue';
import Settings from './frontend/components/Settings.vue';
import ViewerLoader from './frontend/components/ViewerLoader.vue';

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
      path: '/viewer/:id',
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
