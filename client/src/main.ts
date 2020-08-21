import Vue from 'vue';
import VueCompositionApi from '@vue/composition-api';
import VueCoreVideoPlayer from 'vue-core-video-player';

import NotificationBus from '@girder/components/src/utils/notifications';
import snackbarService from '@/lib/vue-utilities/snackbar-service';
import promptService from '@/lib/vue-utilities/prompt-service';
import vMousetrap from '@/lib/vue-utilities/v-mousetrap';

import vuetify from '@/plugins/vuetify';
import girderRest from '@/plugins/girder';
import App from './App.vue';
import router from './router';
import store from './store';

Vue.config.productionTip = false;
Vue.use(VueCompositionApi);
Vue.use(snackbarService(vuetify));
Vue.use(promptService(vuetify));
Vue.use(vMousetrap);
Vue.use(VueCoreVideoPlayer);

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
