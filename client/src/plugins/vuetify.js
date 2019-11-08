import Vue from "vue";
import Vuetify from "vuetify/lib";
import vuetifyConfig from "@girder/components/src/utils/vuetifyConfig.js";

import "@mdi/font/css/materialdesignicons.css";

Vue.use(Vuetify);

vuetifyConfig.theme.dark = true;
vuetifyConfig.theme.themes.dark = {
  secondary: vuetifyConfig.theme.themes.dark.secondary
};

export default new Vuetify(vuetifyConfig);
