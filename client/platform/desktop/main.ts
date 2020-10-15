import Vue from 'vue';
import VueCompositionApi from '@vue/composition-api';

import snackbarService from 'viame-web-common/vue-utilities/snackbar-service';
import promptService from 'viame-web-common/vue-utilities/prompt-service';
import vMousetrap from 'viame-web-common/vue-utilities/v-mousetrap';

import vuetify from './plugins/vuetify';
import router from './router';
import App from './App.vue';

Vue.config.productionTip = false;
Vue.use(VueCompositionApi);
Vue.use(snackbarService(vuetify));
Vue.use(promptService(vuetify));
Vue.use(vMousetrap);


new Vue({
  vuetify,
  router,
  provide: { vuetify },
  render: (h) => h(App),
})
  .$mount('#app')
  .$snackbarAttach()
  .$promptAttach();
