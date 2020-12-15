<script lang="ts">
import {
  defineComponent, reactive, toRefs, onBeforeUnmount,
} from '@vue/composition-api';
import { Authentication as GirderAuth } from '@girder/components/src/components';
import { useGirderRest } from '../plugins/girder';

export default defineComponent({
  name: 'Login',
  components: {
    GirderAuth,
  },
  setup(_, { root }) {
    const data = reactive({
      form: 'login',
      userDialog: true,
    });
    const girderRest = useGirderRest();
    function onLogin() {
      root.$router.push('/');
    }
    girderRest.$on('login', onLogin);
    onBeforeUnmount(() => girderRest.$off('login', onLogin));
    return toRefs(data);
  },
});
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
          src="~viame-web-common/assets/logo.png"
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
          VIAME Web is automatically updated at 2AM EST/EDT on Thursdays.
          Downtime is typically less than 10 minutes.
        </v-alert>
        <div>
          If you need help, check the
          <a href="https://viame.github.io/VIAME-Web/">
            User Documentation
          </a>
          or email <a href="mailto:viame-web@kitware.com">viame-web@kitware.com</a>
        </div>
      </v-alert>
      <GirderAuth
        register
        forgot-password-url="/girder#?dialog=resetpassword"
      />
    </v-dialog>
  </v-container>
</template>
