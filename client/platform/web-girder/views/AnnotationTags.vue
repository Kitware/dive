<!-- eslint-disable max-len -->
<script lang="ts">
import {
  computed,
  defineComponent, ref,
} from 'vue';
import {
  useAnnotationSet,
  useAnnotationSets,
  useDatasetId,
  useHandler,
  useTrackStyleManager,
} from 'vue-media-annotator/provides';
import { useRouter } from 'vue-router/composables';

export default defineComponent({
  name: 'AnnotationTags',
  description: 'Annotation Tags',

  setup() {
    const currentSet = useAnnotationSet();
    const router = useRouter();
    const datasetId = useDatasetId();
    const { reloadAnnotations } = useHandler();

    const { typeStyling } = useTrackStyleManager();
    const sets = useAnnotationSets();
    const newSet = ref('');
    const validForm = ref(false);
    const { save, setChange } = useHandler();
    const selectSet = (set: string) => {
      setChange(set);
    };

    const addSet = async () => {
      await save(newSet.value);
      setChange(newSet.value);
    };

    const selectedSet = ref(currentSet.value || 'default');

    const compareChecks = ref(sets.value.map((item) => ({ name: item, checked: false })));

    const selectedComparisons = computed(() => compareChecks.value.filter((item) => item.checked).map((item) => item.name));
    const launchComparison = () => {
      const set = currentSet.value ? `/set/${currentSet.value}` : '';
      router.replace({
        path: `/viewer/${datasetId.value}${set}`,
        query: { comparisonSets: selectedComparisons.value },
      });
      reloadAnnotations();
    };

    const selectForComparison = (set: string) => {
      compareChecks.value = sets.value.map((item) => ({ name: item, checked: set === item }));
    };
    return {
      currentSet,
      selectSet,
      sets,
      newSet,
      addSet,
      validForm,
      typeStyling,
      selectedSet,
      compareChecks,
      selectedComparisons,
      launchComparison,
      selectForComparison,
    };
  },
});
</script>

<template>
  <div>
    <p> Available Sets</p>
    <v-list>
      <v-list-item>
        <v-row
          dense
          align="center"
        >
          <v-col cols="8">
            Set
          </v-col>
          <v-col cols="4">
            Compare
          </v-col>
        </v-row>
      </v-list-item>
      <v-list-item
        v-for="(set, index) in set"
        :key="set"
        :class="{ border: (set === currentSet || (!currentSet && set === 'default')) }"
      >
        <v-row
          dense
          align="center"
        >
          <v-col cols="8">
            <v-chip
              outlined
              small
              :color="typeStyling.annotationSetColor(set)"
              @click="selectSet(set)"
            >
              <span>
                {{ `${set}${set === currentSet || (!currentSet && set === 'default') ? '*' : ''}` }}
              </span>
            </v-chip>
          </v-col>
          <v-col cols="4">
            <v-switch
              :value="compareChecks[index].checked"
              :disabled="selectedSet === compareChecks[index].name"
              dense
              @change="selectForComparison(set)"
            />
          </v-col>
        </v-row>
      </v-list-item>
    </v-list>
    <v-divider />
    <div v-if="selectedComparisons.length">
      <p> Compare {{ selectedComparisons.join(', ') }} sets</p>
      <v-btn
        color="primary"
        @click="launchComparison()"
      >
        Compare
      </v-btn>
      <v-divider />
    </div>
    <v-expansion-panels>
      <v-expansion-panel>
        <v-expansion-panel-header> Add New Set</v-expansion-panel-header>
        <v-expansion-panel-content>
          <p>
            Add a new Set with a custom name that can be used to reference it in the future.
            'default' is a reserved set which can't be used.
            Adding a new set name wioh the current annotations and copy them to the new set.
          </p>
          <v-form v-model="validForm">
            <v-text-field
              v-model="newSet"
              label="Set"
              :rules="[
                v => !sets.includes(v) || 'Using a reserved set',
                v => !!v || 'Need to have some set name to add',
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

<style scoped>
.border {
  border: 2px dashed cyan;
}
</style>
