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
  useEditingMode,
  useHandler,
  useTrackFilters,
  useTrackStore,
  useAttributes,
  useMultiSelectList,
  useTime,
  useReadOnlyMode,
  useTrackStyleManager,
} from 'vue-media-annotator/provides';
import { Attribute } from 'vue-media-annotator/use/useAttributes';
import TrackItem from 'vue-media-annotator/components/TrackItem.vue';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';

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
    TooltipBtn,
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
    const readOnlyMode = useReadOnlyMode();
    const attributes = useAttributes();
    const editingAttribute: Ref<Attribute | null> = ref(null);
    const editingError: Ref<string | null> = ref(null);
    const editingModeRef = useEditingMode();
    const typeStylingRef = useTrackStyleManager().typeStyling;
    const allTypesRef = useTrackFilters().allTypes;
    const trackStore = useTrackStore();
    const multiSelectList = useMultiSelectList();
    const multiSelectInProgress = computed(() => multiSelectList.value.length > 0);
    const {
      trackSelectNext, trackSplit, removeTrack, unstageFromMerge,
    } = useHandler();

    //Edit/Set single value by clicking
    const editIndividual: Ref<Attribute | null> = ref(null);

    const { frame: frameRef } = useTime();
    const selectedTrackIdRef = useSelectedTrackId();
    const { setAttribute, deleteAttribute } = useHandler();
    const selectedTrackList = computed(() => {
      if (multiSelectList.value.length > 0) {
        return multiSelectList.value.map((trackId) => trackStore.get(trackId));
      }
      if (selectedTrackIdRef.value !== null) {
        return [trackStore.get(selectedTrackIdRef.value)];
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
            if (!readOnlyMode.value && selectedTrackIdRef.value !== null) {
              removeTrack([selectedTrackIdRef.value]);
            }
          },
          disabled,
        },
        {
          bind: 'x',
          handler: () => !readOnlyMode.value
          && trackSplit(selectedTrackIdRef.value, frameRef.value),
          disabled,
        },
      ];
    });

    return {
      selectedTrackIdRef,
      readOnlyMode,
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
      multiSelectList,
      multiSelectInProgress,
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
      unstageFromMerge,
    };
  },
});
</script>

<template>
  <div
    v-mousetrap="mouseTrap"
    :style="{ width: `${width}px` }"
    class="d-flex flex-column fill-height overflow-hidden"
    @click="resetEditIndividual"
  >
    <v-subheader style="min-height: 48px;">
      {{ multiSelectInProgress ? 'Merge or Group Candidates' : 'Track Editor' }}
    </v-subheader>
    <div
      v-if="!selectedTrackList.length"
      class="ml-4 body-2 text-caption"
    >
      <p>No track selected.</p>
      <p>
        This panel is used for:
        <ul>
          <li>Setting attributes on tracks and keyframes</li>
          <li>Merging several tracks together</li>
          <li>Viewing and managing class types and conficence values</li>
        </ul>
      </p>
      <p>Select a track to populate this editor.</p>
      <span
        style="text-decoration: underline; cursor: pointer;"
        @click="$emit('back')"
      >
        ← back to track list (press `a` to toggle)
      </span>
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
      <div class="multi-select-list">
        <v-card
          v-for="track in selectedTrackList"
          :key="track.trackId"
          class="mx-2 mb-2 d-flex align-center"
          outlined
          flat
        >
          <track-item
            :solo="true"
            :merging="multiSelectInProgress"
            :track="track"
            :track-type="track.confidencePairs[0][0]"
            :selected="true"
            :editing="!!editingModeRef"
            :input-value="true"
            :color="typeStylingRef.color(track.confidencePairs[0][0])"
            :lock-types="lockTypes"
            class="grow"
            @seek="$emit('track-seek', $event)"
          />

          <tooltip-btn
            v-if="multiSelectInProgress"
            icon="mdi-close"
            tooltip-text="Remove from merge group"
            @click="unstageFromMerge([track.trackId])"
          />
        </v-card>
      </div>
      <div class="d-flex flex-column">
        <v-btn
          v-if="!multiSelectInProgress"
          color="primary lighten-1"
          class="mx-2 mb-2 grow"
          :disabled="readOnlyMode"
          depressed
          x-small
          @click="$emit('toggle-merge')"
        >
          <v-icon
            small
            class="pr-1"
          >
            mdi-call-merge
          </v-icon>
          <v-spacer />
          Begin Track Merge (m)
        </v-btn>
        <v-btn
          v-if="!multiSelectInProgress"
          color="primary darken-1"
          class="mx-2 mb-2 grow"
          :disabled="readOnlyMode"
          depressed
          x-small
          @click="$emit('toggle-merge')"
        >
          <v-icon
            small
            class="pr-1"
          >
            mdi-group
          </v-icon>
          <v-spacer />
          Begin Track Group (g)
        </v-btn>
        <v-btn
          v-if="multiSelectInProgress"
          color="primary lighten-1"
          x-small
          depressed
          :disabled="multiSelectList.length < 2"
          class="mx-2 mb-2 grow"
          @click="$emit('commit-merge')"
        >
          <v-icon
            class="pr-1"
            small
          >
            mdi-call-merge
          </v-icon>
          <v-icon
            class="pr-1"
            small
          >
            mdi-check
          </v-icon>
          <v-spacer />
          Commit Merge (shift+m)
        </v-btn>
        <v-btn
          v-if="multiSelectInProgress"
          color="primary darken-1"
          x-small
          depressed
          :disabled="multiSelectList.length < 1"
          class="mx-2 mb-2 grow"
          @click="$emit('commit-group')"
        >
          <v-icon
            class="pr-1"
            small
          >
            mdi-group
          </v-icon>
          <v-icon
            class="pr-1"
            small
          >
            mdi-check
          </v-icon>
          <v-spacer />
          Create Group with {{ multiSelectList.length }} tracks (shift+g)
        </v-btn>
        <v-btn
          v-if="multiSelectInProgress"
          color="error"
          class="mx-2 mb-2 grow"
          :disabled="readOnlyMode"
          depressed
          x-small
          @click="$emit('toggle-merge')"
        >
          Abort (esc)
        </v-btn>
      </div>
      <confidence-subsection
        style="max-height:33vh;"
        :confidence-pairs="
          flatten(selectedTrackList.map((t) => t.confidencePairs)).sort((a, b) => b[1] - a[1])
        "
        :disabled="selectedTrackList.length > 1"
        @set-type="selectedTrackList[0].setType($event)"
      />
      <attribute-subsection
        v-if="!multiSelectInProgress"
        mode="Track"
        :attributes="attributes"
        :edit-individual="editIndividual"
        @edit-attribute="editAttribute($event)"
        @set-edit-individual="setEditIndividual($event)"
        @add-attribute="addAttribute"
      />
      <attribute-subsection
        v-if="!multiSelectInProgress"
        mode="Detection"
        :attributes="attributes"
        :edit-individual="editIndividual"
        @edit-attribute="editAttribute($event)"
        @set-edit-individual="setEditIndividual($event)"
        @add-attribute="addAttribute"
      />
    </template>
    <v-spacer />
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
  </div>
</template>

<style lang="scss" scoped>
.multi-select-list {
  overflow-y: auto;
  max-height: 50vh;
}
</style>
