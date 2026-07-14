import Vue from 'vue';

import promptService, { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';

import type { CliTranscodingNotice } from './constants';
import vuetify from './plugins/vuetify';
import router from './router';
import * as api from './frontend/api';
import { migrate } from './frontend/store';
import { setRecents } from './frontend/store/dataset';
import { setOrGetConversionJob } from './frontend/store/jobs';
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

  // CLI open hit media that needs conversion. Surface that on the home screen
  // (cold start) and while another dataset is already open (second instance);
  // do not navigate until desktop:open-dataset after conversion completes.
  window.diveDesktop.on('desktop:cli-transcoding', async (payload) => {
    const notice = payload as CliTranscodingNotice;
    try {
      setRecents(await api.loadMetadata(notice.datasetId));
    } catch {
      // Still show the dialog even if recents cannot be updated yet.
    }
    setOrGetConversionJob(notice.datasetId, true);
    try {
      const { prompt } = usePrompt();
      prompt({
        title: 'Transcoding required',
        text: [
          `"${notice.name}" must be transcoded before it can be opened.`,
          `Converting ${notice.mediaCount} item(s). The viewer will open when conversion finishes.`,
          'You can follow progress from the Jobs page.',
        ],
        positiveButton: 'OK',
      });
    } catch {
      // Prompt service not attached yet; console + Jobs page still cover it.
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
