import { createApp } from 'vue';

import installPromptService from 'dive-common/vue-utilities/prompt-service';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';

import vuetify from './plugins/vuetify';
import router from './router';
import { migrate } from './frontend/store';
import App from './App.vue';

migrate().then(() => {
  const app = createApp(App);
  app.use(router);
  app.use(vuetify);
  app.use(vMousetrap);
  app.use(installPromptService(vuetify));
  app.provide('vuetify', vuetify);
  app.mount('#app');
});
