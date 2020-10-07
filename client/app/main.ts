import Vue from 'vue';
import VueGtag from 'vue-gtag';
import VueCompositionApi from '@vue/composition-api';
import NotificationBus from '@girder/components/src/utils/notifications';
import { init as SentryInit } from '@sentry/browser';
import { Vue as SentryVue } from '@sentry/integrations';

import snackbarService from 'app/vue-utilities/snackbar-service';
import promptService from 'app/vue-utilities/prompt-service';
import vMousetrap from 'app/vue-utilities/v-mousetrap';
import vuetify from 'app/plugins/vuetify';
import girderRest from 'app/plugins/girder';

import App from './App.vue';
import router from './router';
import store from './store';

Vue.config.productionTip = false;
Vue.use(VueCompositionApi);
Vue.use(snackbarService(vuetify));
Vue.use(promptService(vuetify));
Vue.use(vMousetrap);
Vue.use(VueGtag, {
  config: { id: process.env.VUE_APP_GTAG },
});

SentryInit({
  dsn: process.env.VUE_APP_SENTRY_DSN,
  integrations: [
    new SentryVue({ Vue, logErrors: true }),
  ],
  release: process.env.VUE_APP_GIT_HASH,
});

const notificationBus = new NotificationBus(girderRest);
notificationBus.connect();

girderRest.fetchUser().then(() => {
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
