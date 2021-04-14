<script>
import UserGuideDialog from 'dive-common/components/UserGuideDialog.vue';

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
      userGuideLink: 'https://kitware.github.io/dive/',
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
          class="mx-1"
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
        <user-guide-dialog />
        <v-card-actions>
          <v-spacer />
          <v-btn
            dense
            depressed
            :href="userGuideLink"
            target="_blank"
            color="secondary darken-2"
            class="ma-2"
          >
            User Guide
            <v-icon class="pl-2">
              mdi-open-in-new
            </v-icon>
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <div />
  </div>
</template>
