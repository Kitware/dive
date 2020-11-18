<script lang="ts">
import {
  computed, defineComponent, onBeforeMount, reactive, Ref, ref,
} from '@vue/composition-api';

import {
  useSelectedTrackId, useFrame, useTrackMap, useEditingMode, useTypeStyling, useAllTypes,
} from 'vue-media-annotator/provides';
import Track, { TrackId, Feature } from 'vue-media-annotator/track';
import TrackItem from 'vue-media-annotator/components/TrackItem.vue';

import { useApi, Attribute } from 'viame-web-common/apispec';
import AttributeInput from 'viame-web-common/components/AttributeInput.vue';
import AttributeEditor from 'viame-web-common/components/AttributeEditor.vue';

function getTrack(trackMap: Readonly<Map<TrackId, Track>>, trackId: TrackId): Track {
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

  },
  setup() {
    const attributes = ref([] as Attribute[]);
    const editingAttribute: Ref<Attribute | null> = ref(null);
    const editingError: Ref<string | null> = ref(null);
    const trackMap = useTrackMap();
    const editingModeRef = useEditingMode();
    const typeStylingRef = useTypeStyling();
    const allTypesRef = useAllTypes();
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
    const trackAttributes = computed(() => attributes.value.filter(
      (a) => a.belongs === 'track',
    ));
    const detectionAttributes = computed(() => attributes.value.filter(
      (a) => a.belongs === 'detection',
    ));
    const selectedTrack = computed(() => {
      if (selectedTrackIdRef.value !== null) {
        return getTrack(trackMap, selectedTrackIdRef.value);
      }
      return null;
    });

    const selectedDetection = computed(() => {
      const t = selectedTrack.value;
      if (t !== null) {
        const [real] = t.getFeature(frameRef.value);
        return real;
      }
      return null;
    });
    const activeTrackAttributesCount = computed(() => trackAttributes.value.filter(
      (a) => selectedTrack.value && selectedTrack.value.attributes[a.name] !== undefined,
    ).length);
    const activeDetectionAttributesCount = computed(() => detectionAttributes.value.filter(
      (a) => selectedDetection.value && selectedDetection.value.attributes
        && selectedDetection.value.attributes[a.name] !== undefined,
    ).length);

    function setEditIndividual(attribute: Attribute | null) {
      editIndividual.value = attribute;
    }
    function resetEditIndividual(event: MouseEvent) {
      // Only reset if not clicking on a v-input object
      if (editIndividual.value) {
        const path = event.composedPath() as HTMLElement[];
        const inputs = ['INPUT', 'SELECT'];
        if (path.find((item: HTMLElement) => ((item.classList && item.classList.contains('v-input')) || inputs.includes(item.nodeName)))) {
          return;
        }
        editIndividual.value = null;
      }
    }


    function updateTrackAttribute(
      trackId: TrackId | null,
      { name, value }: { name: string; value: unknown },
    ) {
      if (trackId === null) return;
      const track = getTrack(trackMap, trackId);
      track.setAttribute(name, value);
    }

    function updateFeatureAttribute(
      trackId: TrackId | null,
      oldFeature: Feature | null,
      { name, value }: { name: string; value: unknown },
    ) {
      if (trackId === null) return;
      if (oldFeature === null) return;
      const track = getTrack(trackMap, trackId);
      track.setFeatureAttribute(oldFeature.frame, name, value);
    }

    async function closeEditor() {
      editingAttribute.value = null;
      editingError.value = null;
      attributes.value = await getAttributes();
    }

    function trackAttributeAdd() {
      editingAttribute.value = {
        belongs: 'track',
        datatype: 'text',
        name: 'NewTrackAttribute',
        _id: '',
      };
    }
    function editAttribute(attribute: Attribute) {
      editingAttribute.value = attribute;
    }
    function detectionAttributeAdd() {
      editingAttribute.value = {
        belongs: 'detection',
        datatype: 'text',
        name: 'NewDetecitonAttribute',
        _id: '',
      };
    }
    function confidencePairsAdd() {
      //TODO:  Ability to add and edit confidence Pairs
    }
    async function saveAttribtueHandler(saveData: {
      addNew: boolean | undefined; data: Attribute;
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

    async function toggleActiveSettings(
      type: 'confidencePairs' | 'trackAttributes' | 'detectionAttributes',
    ) {
      activeSettings[type] = !activeSettings[type];
      if (!activeSettings[type]) {
        attributes.value = await getAttributes();
      }
    }

    onBeforeMount(async () => {
      attributes.value = await getAttributes();
    });

    return {
      selectedTrackIdRef,
      /* Attributes */
      detectionAttributes,
      trackAttributes,
      activeSettings,
      activeTrackAttributesCount,
      activeDetectionAttributesCount,
      /* Editing */
      editingAttribute,
      saveAttribtueHandler,
      deleteAttributeHandler,
      editingError,
      editIndividual,
      /* Selected */
      selectedDetection,
      selectedTrack,
      /* Update functions */
      closeEditor,
      editAttribute,
      toggleActiveSettings,
      updateFeatureAttribute,
      updateTrackAttribute,
      trackAttributeAdd,
      detectionAttributeAdd,
      confidencePairsAdd,
      editingModeRef,
      typeStylingRef,
      allTypesRef,
      setEditIndividual,
      resetEditIndividual,
    };
  },
});
</script>

<template>
  <v-card
    ref="card"
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
            style="font-size:.8em"
          >
            <v-col cols="1">
              <div
                :style="{
                  marginTop:'5px',
                  minWidth:'10px',
                  maxWidth:'10px',
                  minHeight:'10px',
                  maxHeight:'10px',
                  backgroundColor:typeStylingRef.color(pair[0])
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

      <!-- TRACK ATTRIBUTES -->
      <div class="border-highlight">
        <v-row
          no-gutters
          class="align-center"
        >
          <b>Track Attributes:</b>
          <v-spacer />
          <v-tooltip
            open-delay="200"
            bottom
            max-width="200"
          >
            <template #activator="{ on }">
              <v-btn
                outlined
                x-small
                v-on="on"
                @click="trackAttributeAdd"
              >
                <v-icon small>
                  mdi-plus
                </v-icon>
                Attribute
              </v-btn>
            </template>
            <span>Add a new Track Attribute</span>
          </v-tooltip>
          <v-tooltip
            open-delay="200"
            bottom
            max-width="200"
          >
            <template #activator="{ on }">
              <v-btn
                small
                icon
                class="ml-2"
                :color="activeSettings.trackAttributes ? 'accent': ''"
                v-on="on"
                @click="toggleActiveSettings('trackAttributes')"
              >
                <v-icon small>
                  mdi-eye
                </v-icon>
              </v-btn>
            </template>
            <span>Show/Hide un-used</span>
          </v-tooltip>
        </v-row>
      </div>

      <v-row
        class="ma-0 scroll-section"
        dense
      >
        <v-col
          v-if="activeSettings.trackAttributes ||activeTrackAttributesCount"
          class="pa-2"
        >
          <span
            v-for="(attribute, i) of trackAttributes"
            :key="i"
          >
            <v-row
              v-if="
                activeSettings.trackAttributes ||
                  selectedTrack.attributes[attribute.name] !== undefined"
              class="ma-0 flex-nowrap"
              dense
              align="center"
            >
              <v-col class="attribute-name">
                {{ attribute.name }}:
              </v-col>
              <v-col class="px-1">
                <AttributeInput
                  v-if="activeSettings.trackAttributes"
                  :datatype="attribute.datatype"
                  :name="attribute.name"
                  :values="attribute.values ? attribute.values : null"
                  :value="
                    selectedTrack
                      ? selectedTrack.attributes[attribute.name]
                      : undefined
                  "
                  @change="updateTrackAttribute(selectedTrackIdRef, $event)"
                  @click.stop.prevent=""
                />
                <div v-else>
                  <div
                    v-if="editIndividual != attribute"
                    class="attribute-item-value"
                    @click.stop="setEditIndividual(attribute)"
                  >
                    {{ selectedTrack.attributes[attribute.name] }}
                  </div>
                  <div v-else>
                    <AttributeInput
                      :datatype="attribute.datatype"
                      :name="attribute.name"
                      :values="attribute.values ? attribute.values : null"
                      :value="
                        selectedTrack
                          ? selectedTrack.attributes[attribute.name]
                          : undefined
                      "
                      @change="updateTrackAttribute(selectedTrackIdRef, $event)"
                      @click.stop.prevent=""
                    />

                  </div>
                </div>
              </v-col>
              <v-col
                v-if="activeSettings.trackAttributes"
                cols="1"
              >
                <v-btn
                  icon
                  small
                  @click="editAttribute(attribute)"
                >
                  <v-icon small>
                    mdi-settings
                  </v-icon>
                </v-btn>
              </v-col>
            </v-row>
          </span>
        </v-col>
        <v-col v-else>
          <div style="font-size:.75em">
            No Track Attributes Set
          </div>
        </v-col>
      </v-row>

      <!-- DETECTION ATTRIBUTES -->
      <div
        v-if="selectedDetection"
        class="border-highlight"
      >
        <v-row
          class="align-center"
          no-gutters
        >
          <b>Detection Attributes:</b>
          <v-spacer />
          <v-tooltip
            open-delay="200"
            bottom
            max-width="200"
          >
            <template #activator="{ on }">
              <v-btn
                outlined
                x-small
                v-on="on"
                @click="detectionAttributeAdd"
              >
                <v-icon small>
                  mdi-plus
                </v-icon>
                Attribute
              </v-btn>
            </template>
            <span>Add a new Detection Attribute</span>
          </v-tooltip>
          <v-tooltip
            open-delay="200"
            bottom
            max-width="200"
          >
            <template #activator="{ on }">
              <v-btn
                small
                icon
                class="ml-2"
                :color="activeSettings.detectionAttributes ? 'accent': ''"
                v-on="on"
                @click="toggleActiveSettings('detectionAttributes')"
              >
                <v-icon small>
                  mdi-eye
                </v-icon>
              </v-btn>
            </template>
            <span>Show/Hide un-used</span>
          </v-tooltip>
        </v-row>
        <v-row
          no-gutters
          class="text-caption"
        >
          {{ `Frame: ${selectedDetection.frame}` }}
        </v-row>
      </div>

      <v-subheader
        v-else
        class="border-highlight"
      >
        No detection selected
      </v-subheader>

      <v-row
        v-if="selectedDetection"
        class="ma-0 scroll-section"
        dense
      >
        <v-col
          v-if="activeSettings.detectionAttributes || activeDetectionAttributesCount"
          class="pa-2"
        >
          <span
            v-for="(attribute, i) of detectionAttributes"
            :key="i"
          >
            <v-row
              v-if="activeSettings.detectionAttributes
                || selectedDetection.attributes[attribute.name] !== undefined"
              class="ma-0"
              dense
              align="center"
            >
              <v-col class="attribute-name">
                {{ attribute.name }}:
              </v-col>
              <v-col class="px-1">
                <AttributeInput
                  v-if="activeSettings.detectionAttributes"
                  :datatype="attribute.datatype"
                  :name="attribute.name"
                  :values="attribute.values ? attribute.values : null"
                  :value="
                    selectedDetection && selectedDetection.attributes
                      ? selectedDetection.attributes[attribute.name]
                      : undefined
                  "
                  @change="updateFeatureAttribute(
                    selectedTrackIdRef, selectedDetection, $event)"
                />
                <div v-else>
                  <div
                    v-if="editIndividual != attribute"
                    class="attribute-item-value"
                    @click.stop="setEditIndividual(attribute)"
                  >
                    {{ selectedDetection.attributes[attribute.name] }}
                  </div>
                  <div v-else>
                    <AttributeInput
                      :datatype="attribute.datatype"
                      :name="attribute.name"
                      :values="attribute.values ? attribute.values : null"
                      :value="
                        selectedDetection && selectedDetection.attributes
                          ? selectedDetection.attributes[attribute.name]
                          : undefined
                      "
                      @change="updateFeatureAttribute(
                        selectedTrackIdRef, selectedDetection, $event)"
                    />
                  </div>
                </div>
              </v-col>
              <v-col
                v-if="activeSettings.detectionAttributes"
                cols="1"
              >
                <v-btn
                  icon
                  small
                  @click="editAttribute(attribute)"
                >
                  <v-icon small>
                    mdi-settings
                  </v-icon>
                </v-btn>
              </v-col>
            </v-row>
          </span>
        </v-col>
        <v-col v-else>
          <div style="font-size:.75em">
            No detection selected
          </div>
        </v-col>
      </v-row>
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
</style>
