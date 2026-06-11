import { createApp, type ComponentPublicInstance } from 'vue';

import promptService from 'dive-common/vue-utilities/prompt-service';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';

import vuetify from './plugins/vuetify';
import router from './router';
import { migrate } from './frontend/store';
import App from './App.vue';

migrate().then(() => {
  const app = createApp(App);
  app.use(vuetify);
  app.use(router);
  app.use(vMousetrap);
  app.use(promptService(vuetify));
  app.provide('vuetify', vuetify);

  const root = app.mount('#app');
  (root as ComponentPublicInstance).$promptAttach();
});
