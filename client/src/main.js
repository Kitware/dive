import Vue from "vue";
import Girder, { RestClient } from "@girder/components/src";
import snackbarService from "vue-utilities/snackbar-service";
import promptService from "vue-utilities/prompt-service";

import { API_URL } from "./constants";
import App from "./App.vue";
import router from "./router";
import store from "./store";
import vuetify from "./plugins/vuetify";
import girder from "./girder";

Vue.config.productionTip = false;

Vue.use(Girder);
Vue.use(snackbarService);
Vue.use(promptService);

var girderRest = new RestClient({ apiRoot: API_URL });
girder.girderRest = girderRest;

girderRest.fetchUser().then(() => {
  new Vue({
    router,
    store,
    vuetify,
    provide: { girderRest },
    render: h => h(App)
  }).$mount("#app");
  // .$snackbarAttach()
  // .$promptAttach();
});
