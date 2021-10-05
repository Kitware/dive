import Vue from 'vue';
import VueGtag from 'vue-gtag';
import VueCompositionApi from '@vue/composition-api';
import { init as SentryInit } from '@sentry/browser';
import { Vue as SentryVue } from '@sentry/integrations';

import registerNotifications from 'vue-media-annotator/notificatonBus';
import promptService from 'dive-common/vue-utilities/prompt-service';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';

import getVuetify from './plugins/vuetify';
import girderRest from './plugins/girder';
import App from './App.vue';
import router from './router';
import store from './store';

Vue.config.productionTip = false;
Vue.use(VueCompositionApi);
Vue.use(vMousetrap);

if (
  process.env.NODE_ENV === 'production'
  && window.location.hostname !== 'localhost'
) {
  SentryInit({
    dsn: process.env.VUE_APP_SENTRY_DSN,
    integrations: [
      new SentryVue({ Vue, logErrors: true }),
    ],
    release: process.env.VUE_APP_GIT_HASH,
    environment: (window.location.hostname === 'viame.kitware.com')
      ? 'production' : 'development',
  });
  Vue.use(VueGtag, {
    config: { id: process.env.VUE_APP_GTAG },
  }, router);
}

Promise.all([
  store.dispatch('Brand/loadBrand'),
  girderRest.fetchUser(),
]).then(() => {
  const vuetify = getVuetify(store.state.Brand.brandData?.vuetify);
  Vue.use(promptService(vuetify));
  new Vue({
    router,
    store,
    vuetify,
    provide: {
      store,
      girderRest,
      notificationBus: girderRest, // gwc.JobList expects this
      vuetify,
    },
    render: (h) => h(App),
  })
    .$mount('#app')
    .$promptAttach();

  /** Start notification stream if everything else succeeds */
  registerNotifications(girderRest).connect();
});
