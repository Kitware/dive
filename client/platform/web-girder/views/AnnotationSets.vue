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
import { useRoute, useRouter } from 'vue-router';

export default defineComponent({
  name: 'AnnotationSets',
  description: 'Annotation Sets',

  setup() {
    const currentSet = useAnnotationSet();
    const router = useRouter();
    const route = useRoute();
    const sets = useAnnotationSets();
    const datasetId = useDatasetId();
    const { typeStyling } = useTrackStyleManager();
    const newSet = ref('');
    const validForm = ref(false);
    const { save, setChange, reloadAnnotations } = useHandler();
    const selectSet = (set: string) => {
      if ((set !== currentSet.value && set !== 'default') || ((set === 'default') && currentSet.value)) {
        setChange(set);
      }
    };

    const activeSetName = computed(() => currentSet.value || 'default');

    const getComparisonFromRoute = (): string | null => {
      const { comparisonSets } = route.query;
      if (!comparisonSets) {
        return null;
      }
      const first = Array.isArray(comparisonSets) ? comparisonSets[0] : comparisonSets;
      return typeof first === 'string' ? first : null;
    };

    const comparedSet = ref<string | null>(getComparisonFromRoute());

    const selectedComparisons = computed(() => (
      comparedSet.value ? [comparedSet.value] : []
    ));

    const launchComparison = () => {
      const set = currentSet.value ? `/set/${currentSet.value}` : '';
      router.replace({
        path: `/viewer/${datasetId.value}${set}`,
        query: { comparisonSets: selectedComparisons.value },
      });
      reloadAnnotations();
    };

    const toggleComparison = (set: string, checked: boolean | null) => {
      comparedSet.value = checked ? set : null;
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
      selectSet,
      sets,
      newSet,
      addSet,
      validForm,
      computedSets,
      typeStyling,
      activeSetName,
      comparedSet,
      selectedComparisons,
      launchComparison,
      toggleComparison,

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
        v-for="set in computedSets"
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
              :model-value="comparedSet === set"
              color="primary"
              density="compact"
              hide-details
              :disabled="activeSetName === set"
              @update:model-value="toggleComparison(set, $event)"
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
        <v-expansion-panel-title> Add New Set</v-expansion-panel-title>
        <v-expansion-panel-text>
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
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>
