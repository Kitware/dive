<script lang="ts">
import Vue from 'vue';
import { PropType } from '@vue/composition-api';
import Recipe from 'vue-media-annotator/recipe';

import headtail from './headtail.vue';

export default Vue.extend({
  components: {
    headtail,
  },
  props: {
    recipeMap: {
      type: Object as PropType<Record<string, Recipe>>,
      required: true,
    },
  },
});
</script>

<template>
  <v-row>
    <v-col class="d-flex align-center px-4">
      <div class="modechip secondary px-2 py-1 mr-3 grey darken-3">
        <v-icon class="pr-1">
          mdi-keyboard
        </v-icon>
        <span class="text-subtitle-2">
          Macros
        </span>
      </div>
      <v-btn-toggle dense group>
        <headtail
          :recipe="recipeMap['headtail']"
          @set-annotation-state="$emit('set-annotation-state', $event)"
        />
      </v-btn-toggle>
    </v-col>
  </v-row>
</template>


<style scoped>
.modechip {
  border-radius: 16px;
  width: 100px;
}
</style>
