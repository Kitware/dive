<script lang="ts">
import {
  computed,
  defineComponent, ref,
} from '@vue/composition-api';
import {
  useAnnotationSet,
  useAnnotationSets,
  useHandler,
} from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'AnnotationSets',
  description: 'Annotation Sets',

  setup() {
    const currentSet = useAnnotationSet();
    const sets = useAnnotationSets();
    const newSet = ref('');
    const validForm = ref(false);
    const { save, setChange } = useHandler();
    const selectedSet = (set: string) => {
      if ((set !== currentSet.value && set !== 'default') || ((set === 'default') && currentSet.value)) {
        setChange(set);
      }
    };

    const computedSets = computed(() => {
      if (!sets.value.length) {
        return sets.value.concat(['default']);
      }
      return sets.value;
    });

    const addSet = async () => {
      await save(newSet.value);
      setChange(newSet.value);
    };

    return {
      currentSet,
      selectedSet,
      sets,
      newSet,
      addSet,
      validForm,
      computedSets,
    };
  },
});
</script>

<template>
  <div>
    <div class="px-4 pt-2 text-body-1">
      Available Sets
    </div>
    <v-list>
      <v-list-item
        v-for="set in computedSets"
        :key="set"
      >
        <v-chip
          outlined
          :color="set === currentSet || (!currentSet && set === 'default') ? 'cyan' : 'white'"
          @click="selectedSet(set)"
        >
          {{ set }}
        </v-chip>
      </v-list-item>
    </v-list>
    <v-divider />
    <v-expansion-panels>
      <v-expansion-panel>
        <v-expansion-panel-header> Add New Set</v-expansion-panel-header>
        <v-expansion-panel-content>
          <p>
            Add a new Set with a custom name that can be used to reference it in the future.
            'default' is a reserved set which can't be used.
            Adding a new set will use the current annotations and copy them to the new set.
          </p>
          <v-form v-model="validForm">
            <v-text-field
              v-model="newSet"
              label="Set"
              :rules="[
                v => !sets.includes(v) || 'Using a reserved set',
                v => !!v || 'requires at least one character',
              ]"
            />
            <v-btn
              :disabled="!validForm"
              @click="addSet()"
            >
              Add Set
            </v-btn>
          </v-form>
        </v-expansion-panel-content>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>
