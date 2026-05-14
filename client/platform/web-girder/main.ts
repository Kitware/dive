import Vue from 'vue';
import VueGtag from 'vue-gtag';
import { init as SentryInit } from '@sentry/browser';
import { Vue as SentryVue } from '@sentry/integrations';

import registerNotifications from 'vue-media-annotator/notificatonBus';
import promptService from 'dive-common/vue-utilities/prompt-service';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';

import getVuetify from './plugins/vuetify';
import girderRest from './plugins/girder';
import App from './App.vue';
import './store';
import router from './router';
import { bindWebGirderRouter } from './store/useLocation';
import { useBrand } from './store/useBrand';
import { useConfig } from './store/useConfig';
import { useUser } from './store/useUser';
import type { UserState } from './store/types';
import { reportHandledPromiseRejection } from './reportHandledPromiseRejection';

bindWebGirderRouter(router);

Vue.config.productionTip = false;
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
  useBrand().loadBrand(),
  useConfig().loadConfig(),
  girderRest.fetchUser(),
]).then(() => {
  useUser().setUser(girderRest.user as UserState['user']);
  const vuetify = getVuetify(useBrand().getBrandData()?.vuetify);
  Vue.use(promptService(vuetify));
  new Vue({
    router,
    vuetify,
    provide: {
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
}).catch((reason) => {
  reportHandledPromiseRejection('app bootstrap (brand, config, or user)', reason);
  const el = document.getElementById('app');
  if (el) {
    el.innerHTML = `
      <div style="padding: 1.5rem; font-family: system-ui, sans-serif; max-width: 40rem;">
        <h1 style="font-size: 1.25rem; margin-top: 0;">Unable to start DIVE</h1>
        <p>Brand settings, server configuration, or sign-in could not be loaded.
        Please refresh the page or contact your administrator.</p>
        <p style="color: #666; font-size: 0.875rem;">
        Technical details are in the browser developer console.</p>
      </div>`;
  }
});
