import Vue from 'vue';
import VueGtag from 'vue-gtag';
import VueCompositionApi from '@vue/composition-api';
import { init as SentryInit } from '@sentry/browser';
import { Vue as SentryVue } from '@sentry/integrations';

import snackbarService from 'viame-web-common/vue-utilities/snackbar-service';
import promptService from 'viame-web-common/vue-utilities/prompt-service';
import vMousetrap from 'viame-web-common/vue-utilities/v-mousetrap';

import getVuetify from './plugins/vuetify';
import girderRest, { notificationBus } from './plugins/girder';
import App from './App.vue';
import router from './router';
import store from './store';

SentryInit({
  dsn: process.env.VUE_APP_SENTRY_DSN,
  integrations: [
    new SentryVue({ Vue, logErrors: true }),
  ],
  release: process.env.VUE_APP_GIT_HASH,
});

Vue.config.productionTip = false;
Vue.use(VueCompositionApi);
Vue.use(vMousetrap);
Vue.use(VueGtag, {
  config: { id: process.env.VUE_APP_GTAG },
});

notificationBus.connect();

Promise.all([
  store.dispatch('Brand/loadBrand'),
  girderRest.fetchUser(),
]).then(() => {
  const vuetify = getVuetify(store.state.Brand.brandData?.vuetify);
  Vue.use(snackbarService(vuetify));
  Vue.use(promptService(vuetify));
  new Vue({
    router,
    store,
    vuetify,
    provide: { girderRest, notificationBus, vuetify },
    render: (h) => h(App),
  })
    .$mount('#app')
    .$snackbarAttach()
    .$promptAttach();
});
