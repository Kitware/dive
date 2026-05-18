<script lang="ts">
import { defineComponent, PropType } from 'vue';
import ControlsContainer from 'dive-common/components/ControlsContainer.vue';
import TrackSettingsPanel from 'dive-common/components/TrackSettingsPanel.vue';
import TrackListColumnSettings from 'dive-common/components/TrackListColumnSettings.vue';
import TrackList from 'vue-media-annotator/components/Tracks/TrackList.vue';
import FilterList from 'vue-media-annotator/components/FilterList.vue';
import TypeSettingsPanel from 'dive-common/components/TypeSettingsPanel.vue';
import ConfidenceFilter from 'dive-common/components/ConfidenceFilter.vue';
import ConfidenceSubsection from 'dive-common/components/ConfidenceSubsection.vue';
import AttributeSubsection from 'dive-common/components/Attributes/AttributesSubsection.vue';
import context from 'dive-common/store/context';

export default defineComponent({
  name: 'BottomPanel',
  components: {
    ControlsContainer,
    TrackList,
    TrackSettingsPanel,
    TrackListColumnSettings,
    FilterList,
    TypeSettingsPanel,
    ConfidenceFilter,
    ConfidenceSubsection,
    AttributeSubsection,
  },
  props: {
    sidebarMode: { type: String, required: true },
    controlsRef: { type: null, required: true },
    controlsCollapsed: { type: Boolean, required: true },
    lineChartData: { type: Array as PropType<unknown[]>, required: true },
    eventChartData: { type: Object as PropType<Record<string, unknown>>, required: true },
    groupChartData: { type: Object as PropType<Record<string, unknown>>, required: true },
    datasetType: { type: String, required: true },
    isDefaultImage: { type: Boolean, required: true },
    clientSettings: { type: Object, required: true },
    trackFilters: { type: Object, required: true },
    attributes: { type: Array, required: true },
    frameRate: { type: Number, required: true },
    readonlyState: { type: Boolean, required: true },
    disableAnnotationFilters: { type: Boolean, required: true },
    promptVisible: { type: Function, required: true },
    confidenceFilters: { type: Object, required: true },
    aggregateSeek: { type: Function, required: true },
    trackStyleManager: { type: Object, required: true },
    bottomRightPanelView: { type: String, required: true },
    toggleBottomRightPanel: { type: Function, required: true },
    selectedTrackForDetails: { type: Object as PropType<object | null>, default: null },
    showConfidenceFirst: { type: Boolean, required: true },
    showTrackAttributesFirst: { type: Boolean, required: true },
    editIndividual: { type: Object as PropType<object | null>, default: null },
    setEditIndividual: { type: Function, required: true },
    resetEditIndividual: { type: Function, required: true },
    addAttribute: { type: Function, required: true },
    editAttribute: { type: Function, required: true },
    saveThreshold: { type: Function, required: true },
  },
  setup() {
    return { context };
  },
});
</script>

<template>
  <div
    class="d-flex flex-shrink-0"
    :style="{
      'border-top': '1px solid #444',
      height: sidebarMode === 'bottom' ? '260px' : 'auto',
    }"
  >
    <div
      class="d-flex flex-column bottom-panel-section"
      :style="{
        width: sidebarMode === 'bottom' ? '28%' : '100%',
        'min-width': '0',
        overflow: 'hidden',
      }"
    >
      <ControlsContainer
        :ref="controlsRef"
        bottom-layout
        :wrap-bottom-controls="sidebarMode === 'bottom'"
        :collapsed.sync="controlsCollapsed"
        v-bind="{
          lineChartData, eventChartData, groupChartData, datasetType, isDefaultImage,
        }"
      />
    </div>

    <div
      v-if="sidebarMode === 'bottom'"
      class="d-flex flex-column bottom-panel-section"
      :style="{ width: '44%', 'min-width': '0', overflow: 'hidden' }"
    >
      <TrackList
        class="fill-height"
        compact
        :new-track-mode="clientSettings.trackSettings.newTrackSettings.mode"
        :new-track-type="clientSettings.trackSettings.newTrackSettings.type"
        :lock-types="clientSettings.typeSettings.lockTypes"
        :hotkeys-disabled="promptVisible() || readonlyState"
        :height="220"
        :fps="frameRate"
        :disabled="disableAnnotationFilters"
        @track-seek="aggregateSeek($event)"
      >
        <template slot="settings">
          <TrackSettingsPanel :all-types="trackFilters.allTypes.value" />
        </template>
        <template slot="column-settings">
          <TrackListColumnSettings
            :attributes="attributes.filter((attr) => attr.belongs === 'track')"
            :fps="frameRate"
          />
        </template>
      </TrackList>
    </div>

    <div
      v-if="sidebarMode === 'bottom'"
      class="d-flex flex-column bottom-panel-section"
      :style="{ width: '28%', 'min-width': '0', overflow: 'hidden' }"
    >
      <div class="right-panel-header d-flex align-center px-2 py-1">
        <span class="right-panel-title">
          {{ bottomRightPanelView === 'filters' ? 'Type Filters' : 'Track Details' }}
        </span>
        <v-spacer />
        <v-tooltip bottom>
          <template #activator="{ on }">
            <v-btn
              icon
              x-small
              v-on="on"
              @click="toggleBottomRightPanel()"
            >
              <v-icon small>
                mdi-swap-horizontal
              </v-icon>
            </v-btn>
          </template>
          <span>{{ bottomRightPanelView === 'filters' ? 'Switch to Track Details' : 'Switch to Type Filters' }}</span>
        </v-tooltip>
      </div>

      <template v-if="bottomRightPanelView === 'filters'">
        <div class="flex-grow-1 bottom-filter-list" style="overflow-y: auto; overflow-x: hidden;">
          <FilterList
            :show-empty-types="clientSettings.typeSettings.showEmptyTypes"
            :height="130"
            :width="300"
            :style-manager="trackStyleManager"
            :filter-controls="trackFilters"
            :disabled="disableAnnotationFilters"
            class="fill-height"
          >
            <template #settings>
              <TypeSettingsPanel
                :all-types="trackFilters.allTypes.value"
                @import-types="trackFilters.importTypes($event)"
              />
            </template>
          </FilterList>
        </div>
        <div class="confidence-row-bottom px-2 py-1">
          <ConfidenceFilter
            :confidence.sync="confidenceFilters.default"
            :disabled="disableAnnotationFilters"
            text="Confidence"
            @end="saveThreshold()"
          >
            <a
              style="text-decoration: underline; color: white;"
              @click="context.toggle('TypeThreshold')"
            >
              Advanced
            </a>
          </ConfidenceFilter>
        </div>
      </template>

      <template v-else>
        <div
          class="flex-grow-1 bottom-details-panel"
          style="overflow-y: auto; overflow-x: hidden;"
          @click="resetEditIndividual"
        >
          <div v-if="selectedTrackForDetails" class="pa-2">
            <ConfidenceSubsection
              v-if="showConfidenceFirst"
              :confidence-pairs="selectedTrackForDetails.confidencePairs"
              :disabled="false"
              @set-type="selectedTrackForDetails.setType($event)"
            />
            <template v-if="showTrackAttributesFirst">
              <AttributeSubsection
                mode="Track"
                :attributes="attributes"
                :edit-individual="editIndividual"
                @edit-attribute="editAttribute($event)"
                @set-edit-individual="setEditIndividual($event)"
                @add-attribute="addAttribute"
              />
              <AttributeSubsection
                mode="Detection"
                :attributes="attributes"
                :edit-individual="editIndividual"
                @edit-attribute="editAttribute($event)"
                @set-edit-individual="setEditIndividual($event)"
                @add-attribute="addAttribute"
              />
            </template>
            <template v-else>
              <AttributeSubsection
                mode="Detection"
                :attributes="attributes"
                :edit-individual="editIndividual"
                @edit-attribute="editAttribute($event)"
                @set-edit-individual="setEditIndividual($event)"
                @add-attribute="addAttribute"
              />
              <AttributeSubsection
                mode="Track"
                :attributes="attributes"
                :edit-individual="editIndividual"
                @edit-attribute="editAttribute($event)"
                @set-edit-individual="setEditIndividual($event)"
                @add-attribute="addAttribute"
              />
            </template>
            <ConfidenceSubsection
              v-if="!showConfidenceFirst"
              :confidence-pairs="selectedTrackForDetails.confidencePairs"
              :disabled="false"
              @set-type="selectedTrackForDetails.setType($event)"
            />
          </div>
          <div v-else class="pa-3 text-caption grey--text">
            No track selected. Select a track to view its type classifications and attributes.
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.bottom-panel-section {
  background-color: #1e1e1e;
  border: 1px solid #555;
  border-radius: 4px;
  margin: 4px;
}

.confidence-row-bottom {
  background-color: #262626;
  border-top: 1px solid #444;
  flex-shrink: 0;
  padding-top: 4px !important;
  padding-bottom: 4px !important;

  .text-body-2 {
    font-size: 14px !important;
    font-weight: 600;
    color: white !important;
  }
}

.bottom-filter-list {
  #type-header b {
    font-size: 14px;
    font-weight: 600;
    color: white;
  }
}

.right-panel-header {
  background-color: #262626;
  border-bottom: 1px solid #444;
  flex-shrink: 0;
  min-height: 28px;
}

.right-panel-title {
  font-size: 14px;
  font-weight: 600;
  color: white;
}
</style>
