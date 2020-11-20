<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeMount,
  reactive,
  Ref,
  ref,
} from '@vue/composition-api';

import {
  useSelectedTrackId,
  useFrame,
  useTrackMap,
  useEditingMode,
  useTypeStyling,
  useAllTypes,
  useHandler,
} from 'vue-media-annotator/provides';
import Track, { TrackId, Feature } from 'vue-media-annotator/track';
import TrackItem from 'vue-media-annotator/components/TrackItem.vue';

import { useApi, Attribute } from 'viame-web-common/apispec';
import AttributeInput from 'viame-web-common/components/AttributeInput.vue';
import AttributeEditor from 'viame-web-common/components/AttributeEditor.vue';
import AttributeSubsection from 'viame-web-common/components/AttributesSubsection.vue';

function getTrack(
  trackMap: Readonly<Map<TrackId, Track>>,
  trackId: TrackId,
): Track {
  const track = trackMap.get(trackId);
  if (track === undefined) {
    throw new Error(`Track ${trackId} missing from map`);
  }
  return track;
}

export default defineComponent({
  components: {
    AttributeInput,
    TrackItem,
    AttributeEditor,
    AttributeSubsection,
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
    const attributes = ref([] as Attribute[]);
    const editingAttribute: Ref<Attribute | null> = ref(null);
    const editingError: Ref<string | null> = ref(null);
    const trackMap = useTrackMap();
    const editingModeRef = useEditingMode();
    const typeStylingRef = useTypeStyling();
    const allTypesRef = useAllTypes();
    const { trackSelectNext, trackSplit, removeTrack } = useHandler();

    //Edit/Set single value by clicking
    const editIndividual: Ref<Attribute | null> = ref(null);

    const activeSettings = reactive({
      confidencePairs: false,
      trackAttributes: false,
      detectionAttributes: false,
    });

    const frameRef = useFrame();
    const selectedTrackIdRef = useSelectedTrackId();
    const { getAttributes, setAttribute, deleteAttribute } = useApi();
    const selectedTrack = computed(() => {
      if (selectedTrackIdRef.value !== null) {
        return getTrack(trackMap, selectedTrackIdRef.value);
      }
      return null;
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
      attributes.value = await getAttributes();
    }

    function addAttribute(type: 'Track' | 'Detection') {
      //TS doesn't understand
      const belongs = type.toLowerCase() as 'track' | 'detection';
      editingAttribute.value = {
        belongs,
        datatype: 'text',
        name: `New${type}Attribute`,
        _id: '',
      };
    }
    function editAttribute(attribute: Attribute) {
      editingAttribute.value = attribute;
    }
    function confidencePairsAdd() {
      //TODO:  Ability to add and edit confidence Pairs
    }
    async function saveAttribtueHandler(saveData: {
      addNew: boolean | undefined;
      data: Attribute;
    }) {
      editingError.value = null;
      try {
        await setAttribute(saveData);
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
        await deleteAttribute(data);
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

    onBeforeMount(async () => {
      attributes.value = await getAttributes();
    });

    return {
      selectedTrackIdRef,
      /* Attributes */
      attributes,
      activeSettings,
      /* Editing */
      editingAttribute,
      saveAttribtueHandler,
      deleteAttributeHandler,
      editingError,
      editIndividual,
      /* Selected */
      selectedTrack,
      /* Update functions */
      closeEditor,
      editAttribute,
      addAttribute,
      confidencePairsAdd,
      editingModeRef,
      typeStylingRef,
      allTypesRef,
      setEditIndividual,
      resetEditIndividual,
      mouseTrap,
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
    <v-subheader>Track Editor</v-subheader>
    <div
      v-if="!selectedTrack"
      class="ml-4 body-2"
    >
      No track selected
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
        :single-display="true"
        :track="selectedTrack"
        :track-type="selectedTrack.confidencePairs[0][0]"
        :selected="true"
        :editing="!!editingModeRef"
        :input-value="true"
        :color="typeStylingRef.color(selectedTrack.confidencePairs[0][0])"
        :lock-types="lockTypes"
        @seek="$emit('track-seek', $event)"
      />

      <!-- CONFIDENCE PAIRS -->
      <div class="border-highlight">
        <v-row
          no-gutters
          class="align-center"
        >
          <b>Confidence Pairs:</b>
          <v-spacer />
          <v-tooltip
            open-delay="200"
            bottom
            max-width="200"
          >
            <template #activator="{ on }">
              <v-btn
                disabled
                outlined
                x-small
                class="my-1"
                v-on="on"
                @click="confidencePairsAdd"
              >
                <v-icon small>
                  mdi-plus
                </v-icon>
                Pair
              </v-btn>
            </template>
            <span>Add a new Confidence Pair</span>
          </v-tooltip>
        </v-row>
      </div>

      <v-row
        dense
        class="scroll-section confidence shrink"
      >
        <v-col dense>
          <v-row
            v-for="(pair, index) in selectedTrack.confidencePairs"
            :key="index"
            class="ml-1"
            dense
            style="font-size: 0.8em"
          >
            <v-col cols="1">
              <div
                class="type-color-box"
                :style="{
                  backgroundColor: typeStylingRef.color(pair[0]),
                }"
              />
            </v-col>
            <v-col>
              {{ pair[0] }}
            </v-col>
            <v-col>
              {{ pair[1].toFixed(2) }}
            </v-col>
          </v-row>
        </v-col>
      </v-row>
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
      max-width="350"
    >
      <attribute-editor
        v-if="editingAttribute != null"
        :selected-attribute="editingAttribute"
        :error="editingError"
        @close="closeEditor"
        @save="saveAttribtueHandler"
        @delete="deleteAttributeHandler"
      />
    </v-dialog>
  </v-card>
</template>

<style lang="scss" scoped>
.attribute-item-value {
  max-width: 80%;
  margin: 0px;
  &:hover {
    cursor: pointer;
    font-weight: bold;
  }
}
.attribute-name {
  font-size: 0.8em;
  max-width: 50%;
  min-width: 50%;
}
.border-highlight {
  border-top: 1px solid gray;
  border-bottom: 1px solid gray;
  color: white;
  font-weight: bold;
  font-size: 0.9em;
  padding: 4px 10px;
  background-color: #272727;
}
.scroll-section {
  overflow-y: auto;
  overflow-x: hidden;
}
.confidence {
  min-height: 40px;
}
.type-color-box {
  margin-top: 5px;
  min-width: 10px;
  max-width: 10px;
  min-height: 10px;
  max-height: 10px;
}
</style>
