<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script>
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
</style>
