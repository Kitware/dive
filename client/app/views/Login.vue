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
          src="../assets/logo.png"
          class="mb-2"
        >
        <h3>Welcome to VIAME Web (Public Beta)</h3>
        <div>
          Log in or register to get started.
        </div>
        <v-alert
          outlined
          class="my-4"
        >
          VIAME Web is automatically updated at 2AM EST/EDT Sundays and Thursdays.
          Downtime is typically less than 10 minutes.
        </v-alert>
        <div>
          If you need help, check the
          <a href="https://github.com/VIAME/VIAME-Web/wiki">
            User Documentation
          </a>
          or email <a href="mailto:viame-web@kitware.com">viame-web@kitware.com</a>
        </div>
      </v-alert>
      <GirderAuth :register="true" />
    </v-dialog>
  </v-container>
</template>
