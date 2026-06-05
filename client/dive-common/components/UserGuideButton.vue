<script>
import UserGuideDialog from 'dive-common/components/UserGuideDialog.vue';
import { useDisplay } from 'vuetify';
import { defineComponent } from 'vue';

export default defineComponent({
  components: {
    UserGuideDialog,
  },
  props: {
    annotating: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const { mdAndDown } = useDisplay();
    return { mdAndDown };
  },
  data() {
    return {
      dialog: false,
      userGuideLink: 'https://kitware.github.io/dive/',
    };
  },
});
</script>
<template>
  <div>
    <v-btn
      v-if="!annotating"
      density="compact"
      variant="flat"
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
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          density="compact"
          variant="flat"
          target="_blank"
          color="secondary darken-2"
          class="mx-1"
        >
          <v-icon>
            mdi-help-circle
          </v-icon>
          <span
            v-show="!mdAndDown"
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
            density="compact"
            variant="flat"
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
