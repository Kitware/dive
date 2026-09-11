import Vue from 'vue';
import Router from 'vue-router';

import Jobs from './frontend/components/Jobs.vue';
import Recent from './frontend/components/Recent.vue';
import Settings from './frontend/components/Settings.vue';
import Addons from './frontend/components/Addons.vue';
import TrainingPage from './frontend/components/TrainingPage.vue';
import ViewerLoader from './frontend/components/ViewerLoader.vue';
import PipelinePage from './frontend/components/PipelinePage.vue';
import ScoringPage from './frontend/components/ScoringPage.vue';
import ReviewPage from './frontend/components/ReviewPage.vue';
import QueryPage from './frontend/components/QueryPage.vue';

Vue.use(Router);

export default new Router({
  routes: [
    { path: '/addons', name: 'addons', component: Addons },
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
      path: '/training',
      name: 'training',
      component: TrainingPage,
    },
    {
      path: '/query',
      name: 'query',
      component: QueryPage,
    },
    {
      path: '/review',
      name: 'review',
      component: ReviewPage,
    },
    {
      path: '/pipeline',
      name: 'pipeline',
      component: PipelinePage,
    },
    {
      path: '/scoring',
      name: 'scoring',
      component: ScoringPage,
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
