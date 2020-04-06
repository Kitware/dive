import Vue from 'vue';
import VueCompositionApi from '@vue/composition-api';

import NotificationBus from '@girder/components/src/utils/notifications';
import snackbarService from 'vue-utilities/snackbar-service';
import promptService from 'vue-utilities/prompt-service';
import vMousetrap from 'vue-utilities/v-mousetrap';

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
    vuetify,
    provide: { girderRest, notificationBus, vuetify },
    render: (h) => h(App),
  })
    .$mount('#app')
    .$snackbarAttach()
    .$promptAttach();
});
