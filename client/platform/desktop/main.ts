import Vue from 'vue';
import VueCompositionApi from '@vue/composition-api';

import snackbarService from 'dive-common/vue-utilities/snackbar-service';
import promptService from 'dive-common/vue-utilities/prompt-service';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';

import vuetify from './plugins/vuetify';
import router from './router';
import { migrate } from './frontend/store';
import App from './App.vue';

Vue.config.productionTip = false;
Vue.use(VueCompositionApi);
Vue.use(snackbarService(vuetify));
Vue.use(promptService(vuetify));
Vue.use(vMousetrap);

migrate().then(() => {
  new Vue({
    vuetify,
    router,
    provide: { vuetify },
    render: (h) => h(App),
  })
    .$mount('#app')
    .$snackbarAttach()
    .$promptAttach();
});
