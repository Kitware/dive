import Vue from "vue";
import Vuetify from "vuetify/lib";
import vuetifyConfig from "@girder/components/src/utils/vuetifyConfig.js";

import "@mdi/font/css/materialdesignicons.css";

Vue.use(Vuetify);

vuetifyConfig.theme.dark = true;
delete vuetifyConfig.theme.themes.dark;

export default new Vuetify(vuetifyConfig);
