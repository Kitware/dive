<script lang="ts">
import {
  defineComponent,
  ref,
  PropType,
  computed,
} from '@vue/composition-api';
import { Attribute } from 'viame-web-common/apispec';
import {
  useSelectedTrackId,
  useFrame,
  useTrackMap,
} from 'vue-media-annotator/provides';
import Track, { TrackId } from 'vue-media-annotator/track';
import AttributeInput from 'viame-web-common/components/AttributeInput.vue';


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
  },
  props: {
    attributes: {
      type: Array as PropType<Attribute[]>,
      required: true,
    },
    editIndividual: {
      type: Object as PropType<Attribute | null>,
      default: null,
    },
    mode: {
      type: String as PropType<'Track' | 'Detection'>,
      required: true,
    },
  },
  setup(props, { emit }) {
    const frameRef = useFrame();
    const selectedTrackIdRef = useSelectedTrackId();
    const trackMap = useTrackMap();
    const activeSettings = ref(false);

    const selectedTrack = computed(() => {
      if (selectedTrackIdRef.value !== null) {
        return getTrack(trackMap, selectedTrackIdRef.value);
      }
      return null;
    });

    const selectedAttributes = computed(() => {
      const t = selectedTrack.value;
      if (t !== null) {
        if (props.mode === 'Track') {
          return t;
        }
        if (props.mode === 'Detection') {
          const [real] = t.getFeature(frameRef.value);
          return real;
        }
      }
      return null;
    });

    const filteredFullAttributes = computed(() => Object.values(props.attributes).filter(
      (attribute: Attribute) => attribute.belongs === props.mode.toLowerCase(),
    ));

    const activeAttributesCount = computed(
      () => props.attributes.filter(
        (a) => selectedAttributes.value
            && selectedAttributes.value.attributes
            && selectedAttributes.value.attributes[a.name] !== undefined,
      ).length,
    );

    function toggleActiveSettings() {
      activeSettings.value = !activeSettings.value;
    }

    function updateAttribute({ name, value }: { name: string; value: unknown }) {
      if (selectedTrackIdRef.value) {
        const track = getTrack(trackMap, selectedTrackIdRef.value);
        if (props.mode === 'Track') {
          track.setAttribute(name, value);
        } else if (props.mode === 'Detection' && frameRef.value !== undefined) {
          track.setFeatureAttribute(frameRef.value, name, value);
        }
      }
    }

    function editAttribute(attribute: Attribute) {
      emit('edit-attribute', attribute);
    }

    function setEditIndividual(attribute: Attribute) {
      emit('set-edit-individual', attribute);
    }
    function addAttribute() {
      emit('add-attribute', props.mode);
    }

    return {
      frameRef,
      activeAttributesCount,
      selectedAttributes,
      filteredFullAttributes,
      activeSettings,
      //functions
      toggleActiveSettings,
      updateAttribute,
      editAttribute,
      addAttribute,
      setEditIndividual,
    };
  },
});
</script>

<template>
  <span class="d-flex flex-column overflow-hidden">
    <div
      v-if="selectedAttributes"
      class="border-highlight"
    >
      <v-row
        class="align-center"
        no-gutters
      >
        <b>{{ mode }} Attributes:</b>
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
              @click="addAttribute"
            >
              <v-icon small>
                mdi-plus
              </v-icon>
              Attribute
            </v-btn>
          </template>
          <span>Add a new {{ mode }} Attribute</span>
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
              :color="activeSettings ? 'accent' : ''"
              v-on="on"
              @click="toggleActiveSettings()"
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
        v-if="mode === 'Detection'"
        no-gutters
        class="text-caption"
      >
        {{ `Frame: ${frameRef}` }}
      </v-row>
    </div>

    <v-subheader
      v-else
      class="border-highlight"
    >
      No detection selected
    </v-subheader>

    <v-row
      v-if="selectedAttributes"
      class="ma-0 scroll-section"
      dense
    >
      <v-col
        v-if="
          activeSettings || activeAttributesCount
        "
        class="pa-0"
      >
        <span
          v-for="(attribute, i) of filteredFullAttributes"
          :key="i"
        >
          <v-row
            v-if="
              activeSettings ||
                selectedAttributes.attributes[attribute.name] !== undefined
            "
            class="ma-0"
            dense
            align="center"
          >
            <v-col class="attribute-name"> {{ attribute.name }}: </v-col>
            <v-col class="px-1">
              <AttributeInput
                v-if="activeSettings"
                :datatype="attribute.datatype"
                :name="attribute.name"
                :values="attribute.values ? attribute.values : null"
                :value="
                  selectedAttributes && selectedAttributes.attributes
                    ? selectedAttributes.attributes[attribute.name]
                    : undefined
                "
                @change="
                  updateAttribute($event)"
              />
              <div v-else>
                <div
                  v-if="editIndividual != attribute"
                  class="attribute-item-value"
                  @click.stop="setEditIndividual(attribute)"
                >
                  {{ selectedAttributes.attributes[attribute.name] }}
                </div>
                <div v-else>
                  <AttributeInput
                    :datatype="attribute.datatype"
                    :name="attribute.name"
                    :values="attribute.values ? attribute.values : null"
                    :value="
                      selectedAttributes && selectedAttributes.attributes
                        ? selectedAttributes.attributes[attribute.name]
                        : undefined
                    "
                    focus
                    @change="updateAttribute($event)"
                  />
                </div>
              </div>
            </v-col>
            <v-col
              v-if="activeSettings"
              cols="1"
            >
              <v-btn
                icon
                x-small
                @click="editAttribute(attribute)"
              >
                <v-icon small> mdi-settings </v-icon>
              </v-btn>
            </v-col>
          </v-row>
        </span>
      </v-col>
      <v-col v-else>
        <div style="font-size: 0.75em">
          No {{ mode }} selected
        </div>
      </v-col>
    </v-row>
  </span>
</template>

<style scoped lang="scss">
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
</style>
