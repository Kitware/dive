<!-- eslint-disable max-len -->
<script lang="ts">
import {
  computed,
  defineComponent, ref,
} from '@vue/composition-api';
import {
  useAnnotationTag,
  useAnnotationTags,
  useDatasetId,
  useHandler,
  useTrackStyleManager,
} from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'AnnotationTags',
  description: 'Annotation Tags',

  setup(_, { root }) {
    const currentTag = useAnnotationTag();
    const datasetId = useDatasetId();
    const { reloadAnnotations } = useHandler();

    const { typeStyling } = useTrackStyleManager();
    const tags = useAnnotationTags();
    const newTag = ref('');
    const validForm = ref(false);
    const { save, tagChange } = useHandler();
    const selectTag = (tag: string) => {
      tagChange(tag);
    };

    const addTag = async () => {
      await save(newTag.value);
      tagChange(newTag.value);
    };

    const selectedTag = ref(currentTag.value || 'default');

    const compareChecks = ref(tags.value.map((item) => ({ name: item, checked: false })));

    const selectedComparisons = computed(() => compareChecks.value.filter((item) => item.checked).map((item) => item.name));
    const launchComparison = () => {
      const tag = currentTag.value ? `/tag/${currentTag.value}` : '';
      root.$router.replace({
        path: `/viewer/${datasetId.value}${tag}`,
        query: { comparisonTags: selectedComparisons.value },
      });
      reloadAnnotations();
    };

    const selectForComparison = (tag: string) => {
      compareChecks.value = tags.value.map((item) => ({ name: item, checked: tag === item }));
    };
    return {
      currentTag,
      selectTag,
      tags,
      newTag,
      addTag,
      validForm,
      typeStyling,
      selectedTag,
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
    <p> Available Tags</p>
    <v-list>
      <v-list-item>
        <v-row
          dense
          align="center"
        >
          <v-col cols="8">
            Tag
          </v-col>
          <v-col cols="4">
            Compare
          </v-col>
        </v-row>
      </v-list-item>
      <v-list-item
        v-for="(tag, index) in tags"
        :key="tag"
        :class="{'border': (tag === currentTag || (!currentTag && tag === 'default'))}"
      >
        <v-row
          dense
          align="center"
        >
          <v-col cols="8">
            <v-chip
              outlined
              small
              :color="typeStyling.tagColor(tag)"
              @click="selectTag(tag)"
            >
              <span>
                {{ `${tag}${tag === currentTag || (!currentTag && tag === 'default') ? '*' : ''}` }}
              </span>
            </v-chip>
          </v-col>
          <v-col cols="4">
            <v-switch
              :value="compareChecks[index].checked"
              :disabled="selectedTag === compareChecks[index].name"
              dense
              @change="selectForComparison(tag)"
            />
          </v-col>
        </v-row>
      </v-list-item>
    </v-list>
    <v-divider />
    <div v-if="selectedComparisons.length">
      <p> Compare {{ selectedComparisons.join(', ') }} tags</p>
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
        <v-expansion-panel-header> Add New Tag</v-expansion-panel-header>
        <v-expansion-panel-content>
          <p>
            Add a new Tag with a custom name that can be used to reference it in the future.
            'default' is a reserved tag which can't be used.
            Adding a new tag will tag the current annotations and copy them to the new tag.
          </p>
          <v-form v-model="validForm">
            <v-text-field
              v-model="newTag"
              label="Tag"
              :rules="[
                v => !tags.includes(v) || 'Using a reserved tag',
                v => !!v || 'Need to have some tag name to add',
              ]"
            />
            <v-btn
              :disabled="!validForm"
              @click="addTag()"
            >
              Add Tag
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
