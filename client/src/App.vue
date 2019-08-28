<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script>
import vuetifyConfig from "@girder/components/src/utils/vuetifyConfig.js";

export default {
  name: "App",
  components: {},
  inject: ["girderRest"],
  data: () => ({
    //
  }),
  watch: {
    "girderRest.user"(user) {
      if (!user) {
        this.$router.push("/login");
      }
    }
  },
  created() {
    // this.$vuetify.theme={isDark:this.$vuetify.isDark};
    this.$vuetify.t = this.$vuetify.lang.t;
    this.$vuetify.locales = this.$vuetify.lang.locales;
    this.$vuetify.locales.en.dataTable.rowsPerPageText = this.$vuetify.locales.en.dataTable.itemsPerPageText;
    Object.assign(
      this.$vuetify.locales.en.dataIterator,
      this.$vuetify.locales.en.dataFooter
    );
    this.$vuetify.locales.en.dataIterator.rowsPerPageAll = this.$vuetify.locales.en.dataFooter.itemsPerPageAll;
    Object.assign(this.$vuetify, this.$vuetify.lang);
    Object.assign(this.$vuetify.icons, this.$vuetify.icons.values);
    Object.assign(this.$vuetify.icons, vuetifyConfig.icons);
  }
};
</script>

<style lang="scss">
// Vuetify version fixes
.layout.row {
  margin-left: 0;
  margin-right: 0;
}

.text-xs-center {
  text-align: center !important;
}

.v-application a {
  color: inherit !important;
}
</style>
