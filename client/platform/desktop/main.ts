import Vue from 'vue';

import promptService from 'dive-common/vue-utilities/prompt-service';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';

import vuetify from './plugins/vuetify';
import router from './router';
import * as api from './frontend/api';
import { migrate } from './frontend/store';
import { setRecents } from './frontend/store/dataset';
import { initializedSettings } from './frontend/store/settings';
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

  // A dataset imported via `dive-desktop --import` opens as soon as it is
  // viewable. Record it in recents first so it also appears in the dataset list
  // afterwards, exactly as if it had been imported through the wizard.
  window.diveDesktop.on('desktop:open-dataset', async (id) => {
    const datasetId = String(id);
    try {
      setRecents(await api.loadMetadata(datasetId));
    } catch {
      // A dataset that cannot be summarized can still be opened; recents is
      // only a convenience listing.
    }
    if (router.currentRoute.name !== 'viewer' || router.currentRoute.params.id !== datasetId) {
      router.push({ name: 'viewer', params: { id: datasetId } });
    }
  });

  new Vue({
    vuetify,
    router,
    provide: { vuetify },
    render: (h) => h(App),
  })
    .$mount('#app')
    .$promptAttach();

  // Ask the main process whether a dataset was requested on the command line.
  // Pulling rather than being pushed avoids racing the listener registration
  // above against an import that finishes before the window is ready.
  //
  // Settings live in the renderer and are handed to the background process at
  // startup; the import needs them (for dataPath), so wait for that handoff to
  // complete before asking, or the backend throws 'settings has not been
  // initialized'.
  initializedSettings.then(() => window.diveDesktop.invoke('desktop:cli-open-pending'));
});
