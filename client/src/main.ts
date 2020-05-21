import Vue from 'vue';
import VueCompositionApi from '@vue/composition-api';

// @ts-ignore missing definitions
import NotificationBus from '@girder/components/src/utils/notifications';
import snackbarService from '@/lib/vue-utilities/snackbar-service';
import promptService from '@/lib/vue-utilities/prompt-service';
import vMousetrap from '@/lib/vue-utilities/v-mousetrap';

import vuetify from '@/plugins/vuetify';
import App from './App.vue';
import router from './router';
import store from './store';
import girderRest from './girder';

Vue.config.productionTip = false;
Vue.use(VueCompositionApi);
Vue.use(snackbarService(vuetify));
Vue.use(promptService(vuetify));
Vue.use(vMousetrap);

const notificationBus = new NotificationBus(girderRest);
notificationBus.connect();

girderRest.fetchUser().then(() => {
  new Vue({
    router,
    store,
    // @ts-ignore: missing definitions because Vue.use(Vuetify) is in a .js file
    vuetify,
    provide: { girderRest, notificationBus, vuetify },
    render: (h) => h(App),
  })
    .$mount('#app')
    .$snackbarAttach()
    .$promptAttach();
});
