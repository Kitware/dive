<script>
import NavigationTitle from "@/components/NavigationTitle";

export default {
  name: "GenericNavigationBar",
  components: {
    NavigationTitle
  },
  inject: ["girderRest"]
};
</script>

<template>
  <v-app-bar app>
    <NavigationTitle>VIAME</NavigationTitle>
    <v-spacer></v-spacer>
    <v-btn text @click="girderRest.logout()">Logout</v-btn>
  </v-app-bar>
</template>
