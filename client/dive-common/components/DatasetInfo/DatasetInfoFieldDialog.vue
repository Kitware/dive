<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';

export default defineComponent({
  name: 'DatasetInfoFieldDialog',

  props: {
    value: {
      type: Boolean,
      default: false,
    },
    fieldName: {
      type: String,
      default: '',
    },
    fieldValue: {
      type: String,
      default: '',
    },
    readonly: {
      type: Boolean,
      default: false,
    },
  },

  setup(props, { emit }) {
    // The dialog owns a draft so edits can be cancelled without touching the
    // parent. Reset it from the source value each time the dialog opens.
    const draft = ref(props.fieldValue);
    watch(() => props.value, (isOpen) => {
      if (isOpen) {
        draft.value = props.fieldValue;
      }
    });

    const isOpen = computed({
      get: () => props.value,
      set: (open: boolean) => emit('input', open),
    });

    const save = () => {
      emit('save', draft.value);
      isOpen.value = false;
    };

    return { draft, isOpen, save };
  },
});
</script>

<template>
  <v-dialog
    v-model="isOpen"
    max-width="600"
  >
    <v-card>
      <v-card-title class="text-h6 editor-title">
        {{ fieldName }}
      </v-card-title>
      <v-card-text>
        <v-textarea
          v-model="draft"
          :readonly="readonly"
          auto-grow
          rows="6"
          outlined
          hide-details
          autofocus
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <template v-if="!readonly">
          <v-btn
            text
            @click="isOpen = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            text
            @click="save"
          >
            Save
          </v-btn>
        </template>
        <v-btn
          v-else
          text
          @click="isOpen = false"
        >
          Close
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.editor-title {
  white-space: normal !important;
  overflow-wrap: anywhere;
}
</style>
