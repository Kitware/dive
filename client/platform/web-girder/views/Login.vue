<script lang="ts">
import {
  defineComponent, reactive, toRefs, onBeforeUnmount,
} from 'vue';
import { GirderAuthentication } from '@girder/components';
import { useRouter } from 'vue-router';

import { useGirderRest } from 'platform/web-girder/plugins/girder';
import { useBrand } from 'platform/web-girder/store/useBrand';
import { getUserHomeRoute } from 'platform/web-girder/store/useLocation';
import { useUser } from 'platform/web-girder/store/useUser';

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
    const { brandData } = useBrand();
    const girderRest = useGirderRest();
    function onLogin() {
      if (girderRest.token) {
        window.localStorage.setItem('girderToken', girderRest.token);
      }
      useUser().setUser(girderRest.user);
      router.push(getUserHomeRoute());
    }
    girderRest.on('userLoggedIn', onLogin);
    onBeforeUnmount(() => girderRest.off('userLoggedIn', onLogin));

    /** Redirect if user already logged in */
    if (girderRest.user) {
      router.replace(getUserHomeRoute());
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
      v-model="userDialog"
      persistent
      max-width="400px"
    >
      <v-alert
        border="start"
        elevation="2"
        border-color="primary"
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
          variant="outlined"
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
