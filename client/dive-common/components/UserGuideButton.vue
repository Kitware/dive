<script lang="ts">
import { defineComponent, ref } from 'vue';
import UserGuideDialog from 'dive-common/components/UserGuideDialog.vue';
import { mergeActivatorProps } from 'dive-common/vue-utilities/mergeActivatorProps';

export default defineComponent({
  components: {
    UserGuideDialog,
  },
  props: {
    annotating: {
      type: Boolean,
      default: false,
    },
    buttonOptions: {
      type: Object,
      default: () => ({
        variant: 'outlined',
        color: 'grey-lighten-1',
        class: ['mx-1'],
      }),
    },
  },
  setup() {
    const dialog = ref(false);
    const userGuideLink = ref('https://kitware.github.io/dive/');
    return {
      mergeActivatorProps,
      dialog,
      userGuideLink,
    };
  },
});
</script>
<template>
  <div>
    <v-btn
      v-if="!annotating"
      dense
      depressed
      :href="userGuideLink"
      target="_blank"
      color="secondary-darken-2"
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
      <template #activator="{ props: dialogProps }">
        <v-tooltip
          location="bottom"
          open-delay="400"
        >
          <template #activator="{ props: tooltipProps }">
            <span
              v-bind="tooltipProps"
              :class="buttonOptions.block ? 'd-flex w-100' : 'd-inline-flex'"
            >
              <v-btn
                v-bind="mergeActivatorProps(dialogProps, buttonOptions)"
              >
                <v-icon>
                  mdi-help-circle
                </v-icon>
                <span
                  v-show="!$vuetify.display.mdAndDown || buttonOptions.block"
                  class="pl-1"
                >
                  Help
                </span>
              </v-btn>
            </span>
          </template>
          <span>View help for annotation tools</span>
        </v-tooltip>
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
            color="secondary-darken-2"
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
  </div>
</template>
