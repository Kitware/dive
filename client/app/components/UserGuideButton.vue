<script>
import UserGuideDialog from 'app/components/UserGuideDialog.vue';

export default {
  components: {
    UserGuideDialog,
  },
  props: {
    annotating: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      dialog: false,
      userGuideLink: 'https://github.com/VIAME/VIAME-Web/wiki/User-Documentation',
    };
  },
};
</script>
<template>
  <div>
    <v-btn
      v-if="!annotating"
      dense
      depressed
      :href="userGuideLink"
      target="_blank"
      color="secondary darken-2"
      class="mx-3"
    >
      <v-icon left>
        mdi-help-circle
      </v-icon>
      User Guide
    </v-btn>
    <v-dialog
      v-else
      v-model="dialog"
      width="800"
    >
      <template #activator="{on}">
        <v-btn
          dense
          depressed
          target="_blank"
          color="secondary darken-2"
          class="mx-3"
          v-on="on"
        >
          <v-icon>
            mdi-help-circle
          </v-icon>
          <span
            v-show="!$vuetify.breakpoint.mdAndDown"
            class="pl-1"
          >
            Help
          </span>
        </v-btn>
      </template>
      <v-card>
        <v-card-title>
          Help
        </v-card-title>
        <v-card-text>
          <user-guide-dialog />
          <v-divider />
          <v-card-actions>
            <v-spacer />
            <v-btn
              dense
              depressed
              :href="userGuideLink"
              target="_blank"
              color="secondary darken-2"
              class="mx-3"
            >
              User Guide
              <v-icon class="pl-2">
                mdi-help-circle
              </v-icon>
            </v-btn>
            <v-spacer />
          </v-card-actions>
        </v-card-text>
      </v-card>
    </v-dialog>
    <div />
  </div>
</template>
