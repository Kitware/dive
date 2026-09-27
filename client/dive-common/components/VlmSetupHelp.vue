<script lang="ts">
import { defineComponent } from 'vue';

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

/** How to get a vision-language model served locally when it is missing. */
export default defineComponent({
  name: 'VlmSetupHelp',
  props: {
    model: {
      type: String,
      required: true,
    },
    /** Whether the Ollama server answered */
    serverAvailable: {
      type: Boolean,
      default: false,
    },
    checking: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['check', 'open-link'],
  setup() {
    return { OLLAMA_DOWNLOAD_URL };
  },
});
</script>

<template>
  <v-alert
    type="info"
    dense
    text
    class="text-body-2 mb-2"
  >
    <div class="mb-1">
      <strong>{{ model }}</strong> is not installed.
    </div>
    <ol class="pl-4">
      <li v-if="!serverAvailable">
        Install and start Ollama from
        <a @click.prevent="$emit('open-link', OLLAMA_DOWNLOAD_URL)">{{ OLLAMA_DOWNLOAD_URL }}</a>.
      </li>
      <li>
        In a terminal, run <code>ollama pull {{ model }}</code>
        (a download of several GB).
      </li>
      <li>Check again once it finishes.</li>
    </ol>
    <v-btn
      small
      outlined
      color="primary"
      class="mt-2"
      :loading="checking"
      @click="$emit('check')"
    >
      Check again
    </v-btn>
  </v-alert>
</template>
