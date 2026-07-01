import Vue from 'vue';

import promptService from 'dive-common/vue-utilities/prompt-service';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';

import vuetify from './plugins/vuetify';
import router from './router';
import { migrate } from './frontend/store';
import { runCloseGuard } from './frontend/store/closeGuard';
import App from './App.vue';

Vue.config.productionTip = false;
Vue.use(promptService(vuetify));
Vue.use(vMousetrap);

migrate().then(() => {
  window.diveDesktop.on('desktop:close-requested', async () => {
    const allow = await runCloseGuard();
    window.diveDesktop.send('desktop:close-response', allow);
  });

  new Vue({
    vuetify,
    router,
    provide: { vuetify },
    render: (h) => h(App),
  })
    .$mount('#app')
    .$promptAttach();
});
