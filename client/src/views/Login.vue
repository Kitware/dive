<script>
import { Authentication as GirderAuth } from '@girder/components/src/components';

export default {
  name: 'Login',
  components: {
    GirderAuth,
  },
  inject: ['girderRest'],
  data() {
    return {
      form: 'login',
      userDialog: true,
    };
  },
  watch: {
    'girderRest.user': {
      handler(user) {
        if (user) {
          this.$router.push('/');
        }
      },
    },
  },
};
</script>

<template>
  <v-container>
    <v-dialog
      :value="userDialog"
      persistent
      max-width="400px"
    >
      <v-alert
        border="left"
        elevation="2"
        colored-border
        color="primary"
        class="pl-8"
      >
        <img
          style="width: 100%"
          src="@/assets/logo.png"
          class="mb-2"
        >
        <h3>Welcome to VIAME Web (Public Beta)</h3>
        <span>
          Log in or register to get started.
        </span>
      </v-alert>
      <GirderAuth :register="true" />
    </v-dialog>
  </v-container>
</template>
