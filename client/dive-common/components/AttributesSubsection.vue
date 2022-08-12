<script lang="ts">
import {
  defineComponent,
  ref,
  PropType,
  computed,
} from '@vue/composition-api';
import {
  useSelectedTrackId,
  useCameraStore,
  useTime,
  useReadOnlyMode,
  useAttributesFilters,
} from 'vue-media-annotator/provides';
import type { Attribute, AttributeFilter } from 'vue-media-annotator/use/useAttributes';
import AttributeInput from 'dive-common/components/AttributeInput.vue';
import PanelSubsection from 'dive-common/components/PanelSubsection.vue';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';
import context from 'dive-common/store/context';

export default defineComponent({
  components: {
    AttributeInput,
    PanelSubsection,
    TooltipBtn,
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
    const readOnlyMode = useReadOnlyMode();
    const { frame: frameRef } = useTime();
    const selectedTrackIdRef = useSelectedTrackId();
    const { attributeFilters, sortAndFilterAttributes, timelineEnabled } = useAttributesFilters();
    const cameraStore = useCameraStore();
    const activeSettings = ref(true);
    const sortingMethods = ['a-z', '1-0'];
    const sortingMethodIcons = ['mdi-sort-alphabetical-ascending', 'mdi-sort-numeric-ascending'];
    const sortingMode = ref(0);

    const selectedTrack = computed(() => {
      if (selectedTrackIdRef.value !== null) {
        return cameraStore.getAnyTrack(selectedTrackIdRef.value);
      }
      return null;
    });

    // Using Revision to nudge the attributes after updating them
    const selectedAttributes = computed(() => {
      if (selectedTrack.value && selectedTrack.value.revision.value) {
        const t = selectedTrack.value;
        if (t !== undefined && t !== null) {
          if (props.mode === 'Track') {
            return t;
          }
          if (props.mode === 'Detection') {
            const [real] = t.getFeature(frameRef.value);
            return real;
          }
        }
      }
      return null;
    });

    const filteredFullAttributes = computed(() => {
      let additionFilters: AttributeFilter[] = [];
      let mode: 'track' | 'detection' = 'track';
      if (props.mode === 'Track') {
        additionFilters = attributeFilters.value.track;
      } else {
        additionFilters = attributeFilters.value.detection;
        mode = 'detection';
      }
      let attributeVals = {};
      if (selectedAttributes.value && selectedAttributes.value.attributes) {
        attributeVals = selectedAttributes.value.attributes;
      }
      return sortAndFilterAttributes(
        props.attributes, mode, attributeVals, sortingMode.value, additionFilters,
      );
    });

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
      if (selectedTrackIdRef.value !== null) {
        // Tracks across all cameras get the same attributes set if they are linked
        const tracks = cameraStore.getTrackAll(selectedTrackIdRef.value);
        if (tracks.length) {
          if (props.mode === 'Track') {
            tracks.forEach((track) => track.setAttribute(name, value));
          } else if (props.mode === 'Detection' && frameRef.value !== undefined) {
            tracks.forEach((track) => track.setFeatureAttribute(frameRef.value, name, value));
          }
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
    function clickSortToggle() {
      sortingMode.value = (sortingMode.value + 1) % sortingMethods.length;
    }

    const filtersActive = computed(() => {
      let additionFilters: AttributeFilter[] = [];
      if (props.mode === 'Track') {
        additionFilters = attributeFilters.value.track;
      } else {
        additionFilters = attributeFilters.value.detection;
      }
      return !!additionFilters.find((filter) => filter.filterData.active === true);
    });

    function openFilter() {
      context.openClose('AttributesSideBar', true, 'Filtering');
    }
    function openTimeline() {
      context.openClose('AttributesSideBar', true, 'Timeline');
    }


    return {
      frameRef,
      activeAttributesCount,
      selectedAttributes,
      filteredFullAttributes,
      activeSettings,
      readOnlyMode,
      //functions
      toggleActiveSettings,
      updateAttribute,
      editAttribute,
      addAttribute,
      setEditIndividual,
      //Sorting & Filters
      sortingMethodIcons,
      sortingMode,
      clickSortToggle,
      openFilter,
      openTimeline,
      timelineEnabled,
      filtersActive,
    };
  },
});
</script>

<template>
  <panel-subsection v-if="selectedAttributes">
    <template
      slot="header"
    >
      <v-row
        class="align-center"
        no-gutters
      >
        <v-col dense>
          <b class="attribute-header">{{ mode }} Attributes</b>
          <div
            v-if="mode === 'Detection'"
            no-gutters
            class="text-caption"
          >
            {{ `Frame: ${frameRef}` }}
          </div>
        </v-col>
        <v-tooltip
          open-delay="200"
          bottom
          max-width="200"
        >
          <template #activator="{ on }">
            <v-btn
              small
              icon
              :disabled="readOnlyMode"
              v-on="on"
              @click="addAttribute"
            >
              <v-icon small>
                mdi-plus
              </v-icon>
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
        <tooltip-btn
          :icon="sortingMethodIcons[sortingMode]"
          tooltip-text="Sort types by value or alphabetically"
          @click="clickSortToggle"
        />
        <tooltip-btn
          icon="mdi-filter"
          :color="filtersActive ? 'primary' : 'default'"
          :tooltip-text="filtersActive
            ? 'Filters are active, click to view': 'No filters are active, click to edit'"
          @click="openFilter"
        />
        <tooltip-btn
          v-if="mode === 'Detection'"
          icon="mdi-chart-line-variant"
          :color="timelineEnabled ? 'primary' : 'default'"
          tooltip-text="Timeline Settings for Attributes"
          @click="openTimeline"
        />
        <div
          v-else
          class="blank-spacer"
        />
      </v-row>
    </template>

    <template
      v-if="selectedAttributes"
      slot="scroll-section"
    >
      <v-col
        v-if="
          activeSettings || activeAttributesCount
        "
        class="pa-0"
      >
        <span
          v-for="(attribute) of filteredFullAttributes"
          :key="attribute.name"
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
            <v-col class="attribute-name"> <div
              class="type-color-box"
              :style="{
                backgroundColor: attribute.color,
              }"
            /><span>{{ attribute.name }}:
            </span>
            </v-col>
            <v-col class="px-1">
              <AttributeInput
                v-if="activeSettings"
                :datatype="attribute.datatype"
                :name="attribute.name"
                :disabled="readOnlyMode"
                :values="attribute.values ? attribute.values : null"
                :value="
                  selectedAttributes && selectedAttributes.attributes
                    ? selectedAttributes.attributes[attribute.name]
                    : undefined
                "
                :type-settings="attribute.editor || null"
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
                    :disabled="readOnlyMode"
                    :values="attribute.values ? attribute.values : null"
                    :value="
                      selectedAttributes && selectedAttributes.attributes
                        ? selectedAttributes.attributes[attribute.name]
                        : undefined
                    "
                    :type-settings="attribute.editor || null"
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
                <v-icon small> mdi-cog </v-icon>
              </v-btn>
            </v-col>
          </v-row>
        </span>
      </v-col>
      <v-col v-else>
        <div style="font-size: 0.75em">
          No {{ mode }} attributes set
        </div>
      </v-col>
    </template>
  </panel-subsection>
</template>

<style scoped lang="scss">
.attribute-header {
  font-size: 12px;
}
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
.type-color-box {
  display: inline-block;
  margin-right: 5px;
  min-width: 8px;
  max-width: 8px;
  min-height: 8px;
  max-height: 8px;
}
.blank-spacer {
  min-width: 28px;
  min-height: 28px;
  max-width: 28px;
  max-height: 28px;
}

</style>
