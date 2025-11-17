<script lang="ts">
import {
  defineComponent, reactive, toRefs, onBeforeUnmount, toRef,
} from 'vue';
import { GirderAuthentication } from '@girder/components/src';

import { useGirderRest } from 'platform/web-girder/plugins/girder';
import { useRouter } from 'vue-router/composables';
import { useStore } from 'platform/web-girder/store/types';

export default defineComponent({
  name: 'Login',
  components: {
    GirderAuthentication,
  },
  setup() {
    const data = reactive({
      form: 'login',
      userDialog: true,
    });
    const router = useRouter();
    const store = useStore();
    const brandData = toRef(store.state.Brand, 'brandData');
    const girderRest = useGirderRest();
    function onLogin() {
      if (girderRest.token) {
        window.localStorage.setItem('girderToken', girderRest.token);
      }
      router.push('/');
    }
    girderRest.$on('login', onLogin);
    onBeforeUnmount(() => girderRest.$off('login', onLogin));

    /** Redirect if user already logged in */
    if (girderRest.user) {
      router.replace('/');
      data.userDialog = false;
    }

    return {
      ...toRefs(data),
      brandData,
    };
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
          :src="brandData.logo"
          class="mb-2"
        >
        <h3>Welcome to {{ brandData.name }} (Public Beta)</h3>
        <div>
          Log in or register to get started.
        </div>
        <v-alert
          outlined
          class="my-4"
        >
          {{ brandData.loginMessage }}
        </v-alert>
        <div>
          If you need help, check the
          <a href="https://kitware.github.io/dive/">
            User Documentation
          </a>
          or email <a href="mailto:viame-web@kitware.com">viame-web@kitware.com</a>
        </div>
      </v-alert>
      <GirderAuthentication
        register
        forgot-password-url="/girder#?dialog=resetpassword"
      />
    </v-dialog>
  </v-container>
</template>
