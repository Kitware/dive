<script lang="ts">
import {
  defineComponent, ref,
} from '@vue/composition-api';
import {
  useAnnotationTag,
  useAnnotationTags,
  useHandler,
} from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'AnnotationTags',
  description: 'Annotation Tags',

  setup() {
    const currentTag = useAnnotationTag();
    const tags = useAnnotationTags();
    const newTag = ref('');
    const validForm = ref(false);
    const { save, tagChange } = useHandler();
    const selectedTag = (tag: string) => {
      tagChange(tag);
    };

    const addTag = async () => {
      await save(newTag.value);
      tagChange(newTag.value);
    };

    return {
      currentTag,
      selectedTag,
      tags,
      newTag,
      addTag,
      validForm,
    };
  },
});
</script>

<template>
  <div>
    <p> Available Tags</p>
    <v-list>
      <v-list-item
        v-for="tag in tags"
        :key="tag"
      >
        <v-chip
          outlined
          :color="tag === currentTag || (!currentTag && tag === 'default') ? 'cyan' : 'white'"
          @click="selectedTag(tag)"
        >
          {{ tag }}
        </v-chip>
      </v-list-item>
    </v-list>
    <v-divider />
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
