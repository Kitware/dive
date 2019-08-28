import Vue from "vue";
import Vuetify from "vuetify/lib";
import vuetifyConfig from "@girder/components/src/utils/vuetifyConfig.js";

import "@mdi/font/css/materialdesignicons.css";

Vue.use(Vuetify);

export default new Vuetify({
  icons: {
    iconfont: "mdi"
  },
  theme: {
    themes: {
      light: vuetifyConfig.theme
    }
  }
});
