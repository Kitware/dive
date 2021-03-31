<script lang="ts">
import {
  computed,
  defineComponent,
  Ref,
  ref,
} from '@vue/composition-api';
import { flatten } from 'lodash';
import {
  useSelectedTrackId,
  useFrame,
  useEditingMode,
  useTypeStyling,
  useAllTypes,
  useHandler,
  useTrackMap,
  useAttributes,
  useMergeList,
} from 'vue-media-annotator/provides';
import { getTrack } from 'vue-media-annotator/use/useTrackStore';
import { Attribute } from 'vue-media-annotator/use/useAttributes';
import TrackItem from 'vue-media-annotator/components/TrackItem.vue';

import AttributeInput from 'dive-common/components/AttributeInput.vue';
import AttributeEditor from 'dive-common/components/AttributeEditor.vue';
import AttributeSubsection from 'dive-common/components/AttributesSubsection.vue';
import ConfidenceSubsection from 'dive-common/components/ConfidenceSubsection.vue';

export default defineComponent({
  components: {
    AttributeInput,
    TrackItem,
    AttributeEditor,
    AttributeSubsection,
    ConfidenceSubsection,
  },
  props: {
    lockTypes: {
      type: Boolean,
      default: false,
    },
    width: {
      type: Number,
      default: 300,
    },
    hotkeysDisabled: {
      type: Boolean,
      required: true,
    },
  },
  setup(props) {
    const attributes = useAttributes();
    const editingAttribute: Ref<Attribute | null> = ref(null);
    const editingError: Ref<string | null> = ref(null);
    const editingModeRef = useEditingMode();
    const typeStylingRef = useTypeStyling();
    const allTypesRef = useAllTypes();
    const trackMap = useTrackMap();
    const mergeList = useMergeList();
    const mergeInProgress = computed(() => mergeList.value.length > 0);
    const {
      trackSelectNext, trackSplit, removeTrack,
    } = useHandler();

    //Edit/Set single value by clicking
    const editIndividual: Ref<Attribute | null> = ref(null);

    const frameRef = useFrame();
    const selectedTrackIdRef = useSelectedTrackId();
    const { setAttribute, deleteAttribute } = useHandler();
    const selectedTrackList = computed(() => {
      if (mergeList.value.length > 0) {
        return mergeList.value.map((trackId) => getTrack(trackMap, trackId));
      }
      if (selectedTrackIdRef.value !== null) {
        return [getTrack(trackMap, selectedTrackIdRef.value)];
      }
      return [];
    });

    function setEditIndividual(attribute: Attribute | null) {
      editIndividual.value = attribute;
    }
    function resetEditIndividual(event: MouseEvent) {
      // Only reset if not clicking on a v-input object
      if (editIndividual.value) {
        const path = event.composedPath() as HTMLElement[];
        const inputs = ['INPUT', 'SELECT'];
        if (
          path.find(
            (item: HTMLElement) => (item.classList && item.classList.contains('v-input'))
              || inputs.includes(item.nodeName),
          )
        ) {
          return;
        }
        editIndividual.value = null;
      }
    }

    async function closeEditor() {
      editingAttribute.value = null;
      editingError.value = null;
    }

    function addAttribute(type: 'Track' | 'Detection') {
      //TS doesn't understand
      const belongs = type.toLowerCase() as 'track' | 'detection';
      editingAttribute.value = {
        belongs,
        datatype: 'text',
        name: `New${type}Attribute`,
        key: '',
      };
    }
    function editAttribute(attribute: Attribute) {
      editingAttribute.value = attribute;
    }
    async function saveAttributeHandler({ data, oldAttribute }: {
      oldAttribute?: Attribute;
      data: Attribute;
    }) {
      editingError.value = null;
      if (!oldAttribute && attributes.value.some((attribute) => (
        attribute.name === data.name
        && attribute.belongs === data.belongs))) {
        editingError.value = 'Attribute with that name exists';
        return;
      }

      try {
        await setAttribute({ data, oldAttribute });
      } catch (err) {
        editingError.value = err.message;
      }
      if (!editingError.value) {
        closeEditor();
      }
    }
    async function deleteAttributeHandler(data: Attribute) {
      editingError.value = null;
      try {
        await deleteAttribute({ data });
      } catch (err) {
        editingError.value = err.message;
      }
      if (!editingError.value) {
        closeEditor();
      }
    }

    const mouseTrap = computed(() => {
      const disabled = props.hotkeysDisabled;
      return [
        {
          bind: 'up',
          handler: () => {
            trackSelectNext(-1);
          },
          disabled,
        },
        {
          bind: 'down',
          handler: () => {
            trackSelectNext(1);
          },
          disabled,
        },
        {
          bind: 'del',
          handler: () => {
            if (selectedTrackIdRef.value !== null) {
              removeTrack([selectedTrackIdRef.value]);
            }
          },
          disabled,
        },
        {
          bind: 'x',
          handler: () => trackSplit(selectedTrackIdRef.value, frameRef.value),
          disabled,
        },
      ];
    });

    return {
      selectedTrackIdRef,
      /* Attributes */
      attributes,
      /* Editing */
      editingAttribute,
      saveAttributeHandler,
      deleteAttributeHandler,
      editingError,
      editIndividual,
      /* Selected */
      selectedTrackList,
      mergeList,
      mergeInProgress,
      /* Update functions */
      closeEditor,
      editAttribute,
      addAttribute,
      editingModeRef,
      typeStylingRef,
      allTypesRef,
      setEditIndividual,
      resetEditIndividual,
      mouseTrap,
      flatten,
    };
  },
});
</script>

<template>
  <v-card
    ref="card"
    v-mousetrap="mouseTrap"
    :width="width"
    class="d-flex flex-column overflow-hidden"
    @click.native="resetEditIndividual"
  >
    <v-subheader>
      {{ mergeInProgress ? `Merge Candidates ${mergeList.length}` : 'Track Editor' }}
    </v-subheader>
    <div
      v-if="!selectedTrackList.length"
      class="ml-4 body-2"
    >
      No Track selected
    </div>
    <template v-else>
      <datalist id="allTypesOptions">
        <option
          v-for="type in allTypesRef"
          :key="type"
          :value="type"
        >
          {{ type }}
        </option>
      </datalist>
      <track-item
        v-for="track in selectedTrackList"
        :key="track.trackId"
        :solo="true"
        :track="track"
        :track-type="track.confidencePairs[0][0]"
        :selected="true"
        :editing="!!editingModeRef"
        :input-value="true"
        :color="typeStylingRef.color(track.confidencePairs[0][0])"
        :lock-types="lockTypes"
        @seek="$emit('track-seek', $event)"
      />
      <div class="d-flex flex-row">
        <v-btn
          :color="mergeInProgress ? 'error' : 'accent'"
          outlined
          class="ma-2 grow"
          x-small
          @click="$emit('toggle-merge')"
        >
          <span v-if="!mergeInProgress">
            Begin Track Merge (m)
          </span>
          <span v-else>
            Abort Merge (m)
          </span>
        </v-btn>
        <v-btn
          v-if="mergeList.length >= 2"
          color="success"
          x-small
          class="ma-2 grow"
          @click="$emit('commit-merge')"
        >
          <v-icon class="pr-1">
            mdi-check
          </v-icon>
          commit (shift+m)
        </v-btn>
      </div>
      <confidence-subsection
        style="max-height:33vh"
        :confidence-pairs="flatten(selectedTrackList.map((t) => t.confidencePairs))"
      />
      <attribute-subsection
        mode="Track"
        :attributes="attributes"
        :edit-individual="editIndividual"
        @edit-attribute="editAttribute($event)"
        @set-edit-individual="setEditIndividual($event)"
        @add-attribute="addAttribute"
      />
      <attribute-subsection
        mode="Detection"
        :attributes="attributes"
        :edit-individual="editIndividual"
        @edit-attribute="editAttribute($event)"
        @set-edit-individual="setEditIndividual($event)"
        @add-attribute="addAttribute"
      />
    </template>
    <v-dialog
      :value="editingAttribute != null"
      max-width="550"
      @click:outside="closeEditor"
      @keydown.esc.stop="closeEditor"
    >
      <attribute-editor
        v-if="editingAttribute != null"
        :selected-attribute="editingAttribute"
        :error="editingError"
        @close="closeEditor"
        @save="saveAttributeHandler"
        @delete="deleteAttributeHandler"
      />
    </v-dialog>
  </v-card>
</template>
