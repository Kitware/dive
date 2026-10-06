<script lang="ts">
import {
  defineComponent, onBeforeUnmount, PropType, ref,
} from 'vue';

export default defineComponent({
  props: {
    save: { type: Function as PropType<() => Promise<void>>, required: true },
    saving: { type: Boolean, default: false },
    readonly: { type: Boolean, default: false },
  },
  setup(props) {
    const show = ref(false);
    const busy = ref(false);
    const error = ref('');
    let pending: Promise<boolean> | undefined;
    let resolve: ((leave: boolean) => void) | undefined;

    function finish(leave: boolean) {
      show.value = false;
      resolve?.(leave);
      resolve = undefined;
      pending = undefined;
    }

    function confirm(): Promise<boolean> {
      if (!pending) {
        error.value = '';
        pending = new Promise((done) => { resolve = done; });
        show.value = true;
      }
      return pending;
    }

    async function saveAndLeave() {
      if (busy.value || props.saving || props.readonly) return;
      busy.value = true;
      error.value = '';
      try {
        await props.save();
        finish(true);
      } catch {
        error.value = 'Unable to save all changes. Please try again or stay on this page.';
      } finally {
        busy.value = false;
      }
    }

    function dismiss(open: boolean) {
      if (!open && !busy.value) finish(false);
    }

    onBeforeUnmount(() => finish(false));
    return {
      show, busy, error, confirm, finish, dismiss, saveAndLeave,
    };
  },
});
</script>

<template>
  <v-dialog :value="show" :persistent="busy" max-width="560" :z-index="999" @input="dismiss">
    <v-card>
      <v-card-title style="word-break: normal;">
        Unsaved changes
      </v-card-title>
      <v-card-text>
        Save your changes before leaving, or discard them?
        <v-alert v-if="error" type="error" class="mt-3">
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn text :disabled="busy" @click="finish(false)">
          Stay
        </v-btn>
        <v-spacer />
        <v-btn text :disabled="busy" @click="finish(true)">
          Discard and leave
        </v-btn>
        <v-btn color="primary" text :loading="busy" :disabled="busy || saving || readonly" @click="saveAndLeave">
          Save and leave
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
