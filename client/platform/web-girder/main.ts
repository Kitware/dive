import { createApp } from 'vue';
import VueGtag from 'vue-gtag-next';
import * as Sentry from '@sentry/vue';

import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';
import installPromptService from 'dive-common/vue-utilities/prompt-service';

import girderRest, { connectNotifications, girderProvide } from './plugins/girder';
import { createDiveVuetify } from './plugins/vuetify';
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

Promise.all([
  useBrand().loadBrand(),
  useConfig().loadConfig(),
  girderRest.fetchUser(),
]).then(() => {
  useUser().setUser(girderRest.user as UserState['user']);
  const vuetify = createDiveVuetify(useBrand().getBrandData()?.vuetify);
  const app = createApp(App);

  if (
    process.env.NODE_ENV === 'production'
    && window.location.hostname !== 'localhost'
  ) {
    Sentry.init({
      app,
      dsn: process.env.VUE_APP_SENTRY_DSN,
      release: process.env.VUE_APP_GIT_HASH,
      environment: (window.location.hostname === 'viame.kitware.com')
        ? 'production' : 'development',
    });
    app.use(VueGtag, {
      property: { id: process.env.VUE_APP_GTAG },
    }, router);
  }

  app.use(router);
  app.use(vuetify);
  app.use(vMousetrap);
  app.use(installPromptService(vuetify));

  app.provide('girder', girderProvide);
  app.provide('girderRest', girderRest);
  app.provide('notificationBus', girderRest);
  app.provide('vuetify', vuetify);

  app.mount('#app');

  connectNotifications();
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
