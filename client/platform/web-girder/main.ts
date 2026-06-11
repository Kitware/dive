import { createApp } from 'vue';
import { init as SentryInit } from '@sentry/browser';
import { Vue as SentryVue } from '@sentry/integrations';

import promptService from 'dive-common/vue-utilities/prompt-service';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';

import getVuetify from './plugins/vuetify';
import girderRest, { girder, initGirderNotifications } from './plugins/girder';
import App from './App.vue';
import './store';
import router from './router';
import { bindWebGirderRouter, useLocation } from './store/useLocation';
import { useBrand } from './store/useBrand';
import { useConfig } from './store/useConfig';
import { useUser } from './store/useUser';
import { initJobs } from './store/useJobs';
import type { UserState } from './store/types';
import { reportHandledPromiseRejection } from './reportHandledPromiseRejection';

bindWebGirderRouter(router);

if (
  process.env.NODE_ENV === 'production'
  && window.location.hostname !== 'localhost'
) {
  SentryInit({
    dsn: process.env.VUE_APP_SENTRY_DSN,
    integrations: [
      new SentryVue({ Vue: { config: {} }, logErrors: true } as any),
    ],
    release: process.env.VUE_APP_GIT_HASH,
    environment: (window.location.hostname === 'viame.kitware.com')
      ? 'production' : 'development',
  });
}

Promise.all([
  useBrand().loadBrand(),
  useConfig().loadConfig(),
  girderRest.fetchUser(),
]).then(async () => {
  if (girderRest.token) {
    window.localStorage.setItem('girderToken', girderRest.token);
  } else {
    window.localStorage.removeItem('girderToken');
  }
  useUser().setUser(girderRest.user as UserState['user']);
  const vuetify = getVuetify(useBrand().getBrandData()?.vuetify);
  const notifications = initGirderNotifications();
  initJobs().catch((reason) => {
    reportHandledPromiseRejection('initJobs', reason);
  });

  const redirectToLogin = () => {
    if (router.currentRoute.value.name !== 'login') {
      router.push({ name: 'login' });
    }
  };
  girderRest.on('userLoggedOut', redirectToLogin);
  girderRest.on('userLoggedIn', (user) => {
    useUser().setUser(user as UserState['user']);
    if (girderRest.token) {
      window.localStorage.setItem('girderToken', girderRest.token);
    }
  });

  const app = createApp(App);
  app.use(router);
  app.use(vuetify);
  app.use(vMousetrap);
  app.use(promptService(vuetify));
  app.provide('girder', girder);
  app.provide('girderRest', girderRest);
  app.provide('notifications', notifications);
  app.provide('notificationBus', notifications.bus);
  app.provide('vuetify', vuetify);

  if (
    process.env.NODE_ENV === 'production'
    && window.location.hostname !== 'localhost'
  ) {
    import('vue-gtag').then(({ default: VueGtag }) => {
      app.use(VueGtag, {
        config: { id: process.env.VUE_APP_GTAG },
        pageTrackerEnabled: true,
      }, router);
    }).catch((reason) => {
      reportHandledPromiseRejection('vue-gtag init', reason);
    });
  }

  try {
    await router.isReady();
    if (router.currentRoute.value.name === 'home') {
      await useLocation().setLocationFromRoute(router.currentRoute.value);
    }
  } catch (reason) {
    reportHandledPromiseRejection('router bootstrap (isReady or location sync)', reason);
  }

  const root = app.mount('#app');
  (root as any).$promptAttach();
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
