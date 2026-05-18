<script lang="ts">
import { defineComponent, computed } from 'vue';
import { clientSettings } from 'dive-common/store/settings';
import TrackItem from '../TrackItem.vue';
import { useReadOnlyMode, useTrackFilters, useTrackStyleManager } from '../../../provides';

export default defineComponent({
  name: 'BottomBarTrackListView',
  components: { TrackItem },
  props: {
    data: { type: Object, required: true },
    filteredTracks: { type: Array, required: true },
    newTrackMode: { type: String, required: true },
    newTrackType: { type: String, required: true },
    trackAdd: { type: Function, required: true },
    multiDelete: { type: Function, required: true },
    virtualListItems: { type: Array, required: true },
    getItemProps: { type: Function, required: true },
    lockTypes: { type: Boolean, required: true },
    disabled: { type: Boolean, required: true },
    fps: { type: Number, default: null },
    virtualListRef: { type: null, required: true },
    mouseTrap: { type: Array, required: true },
    virtualHeight: { type: Number, required: true },
    sortKey: { type: String, required: true },
    handleSort: { type: Function, required: true },
    sortIcon: { type: Function, required: true },
  },
  setup(props) {
    const readOnlyMode = useReadOnlyMode();
    const { allTypes } = useTrackFilters();
    const { typeStyling } = useTrackStyleManager();
    const columnVisibility = computed(
      () => clientSettings.trackSettings.trackListSettings.columnVisibility,
    );
    const newTrackColor = computed(() => {
      if (props.newTrackType !== 'unknown') {
        return typeStyling.value.color(props.newTrackType);
      }
      return '';
    });
    const trackAttributeColumns = computed(
      () => (columnVisibility.value?.attributeColumns || []).filter((key: string) => key.startsWith('track_')),
    );
    return {
      readOnlyMode,
      allTypes,
      columnVisibility,
      newTrackColor,
      trackAttributeColumns,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <div class="compact-header d-flex flex-column px-2 py-1">
      <div class="d-flex align-center">
        <span class="compact-header-text">Tracks ({{ filteredTracks.length }})</span>
        <v-spacer />
        <v-menu
          v-model="data.columnSettingsActive"
          :close-on-content-click="false"
          :nudge-bottom="28"
        >
          <template #activator="{ on: menuOn, attrs }">
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on: tooltipOn }">
                <v-btn
                  icon
                  x-small
                  class="mr-2"
                  v-bind="attrs"
                  v-on="{ ...menuOn, ...tooltipOn }"
                >
                  <v-icon
                    x-small
                    :color="data.columnSettingsActive ? 'accent' : 'default'"
                  >
                    mdi-view-column
                  </v-icon>
                </v-btn>
              </template>
              <span>Column visibility</span>
            </v-tooltip>
          </template>
          <slot
            v-if="data.columnSettingsActive"
            name="column-settings"
          />
        </v-menu>
        <v-menu
          v-model="data.settingsActive"
          :close-on-content-click="false"
          :nudge-bottom="28"
        >
          <template #activator="{ on, attrs }">
            <v-btn
              icon
              x-small
              class="mr-2"
              v-bind="attrs"
              v-on="on"
            >
              <v-icon
                x-small
                :color="data.settingsActive ? 'accent' : 'default'"
              >
                mdi-cog
              </v-icon>
            </v-btn>
          </template>
          <slot
            v-if="data.settingsActive"
            name="settings"
          />
        </v-menu>
        <v-tooltip open-delay="100" bottom>
          <template #activator="{ on }">
            <v-btn
              :disabled="filteredTracks.length === 0 || readOnlyMode"
              icon
              x-small
              class="mr-2"
              v-on="on"
              @click="multiDelete()"
            >
              <v-icon x-small color="error">
                mdi-delete
              </v-icon>
            </v-btn>
          </template>
          <span>Delete visible items</span>
        </v-tooltip>
        <slot name="header-trailing" />
        <v-tooltip
          open-delay="200"
          bottom
          max-width="200"
        >
          <template #activator="{ on }">
            <v-btn
              :disabled="readOnlyMode"
              outlined
              x-small
              :color="newTrackColor"
              v-on="on"
              @click="trackAdd()"
            >
              <v-icon x-small>
                mdi-plus
              </v-icon>
            </v-btn>
          </template>
          <span>Add {{ newTrackMode }} ({{ newTrackType }})</span>
        </v-tooltip>
      </div>
      <div class="compact-column-headers d-flex align-center px-1 mt-1">
        <span class="col-spacer" />
        <span
          class="col-header col-id sortable"
          :class="{ active: sortKey === 'id' }"
          @click="handleSort('id')"
        >
          ID
          <v-icon
            v-if="sortIcon('id')"
            x-small
          >{{ sortIcon('id') }}</v-icon>
        </span>
        <span
          v-if="columnVisibility?.type !== false"
          class="col-header col-type sortable"
          :class="{ active: sortKey === 'type' }"
          @click="handleSort('type')"
        >
          Type
          <v-icon
            v-if="sortIcon('type')"
            x-small
          >{{ sortIcon('type') }}</v-icon>
        </span>
        <span
          v-if="columnVisibility?.confidence !== false"
          class="col-header col-conf sortable"
          :class="{ active: sortKey === 'confidence' }"
          @click="handleSort('confidence')"
        >
          Conf
          <v-icon
            v-if="sortIcon('confidence')"
            x-small
          >{{ sortIcon('confidence') }}</v-icon>
        </span>
        <span
          v-if="columnVisibility?.startFrame"
          class="col-header col-start sortable"
          :class="{ active: sortKey === 'start' }"
          @click="handleSort('start')"
        >
          Start
          <v-icon
            v-if="sortIcon('start')"
            x-small
          >{{ sortIcon('start') }}</v-icon>
        </span>
        <span
          v-if="columnVisibility?.endFrame"
          class="col-header col-end sortable"
          :class="{ active: sortKey === 'end' }"
          @click="handleSort('end')"
        >
          End
          <v-icon
            v-if="sortIcon('end')"
            x-small
          >{{ sortIcon('end') }}</v-icon>
        </span>
        <span
          v-if="columnVisibility?.startTimestamp"
          class="col-header col-timestamp sortable"
          :class="{ active: sortKey === 'startTime' }"
          @click="handleSort('startTime')"
        >
          Start Time
          <v-icon
            v-if="sortIcon('startTime')"
            x-small
          >{{ sortIcon('startTime') }}</v-icon>
        </span>
        <span
          v-if="columnVisibility?.endTimestamp"
          class="col-header col-timestamp sortable"
          :class="{ active: sortKey === 'endTime' }"
          @click="handleSort('endTime')"
        >
          End Time
          <v-icon
            v-if="sortIcon('endTime')"
            x-small
          >{{ sortIcon('endTime') }}</v-icon>
        </span>
        <span
          v-for="attrKey in trackAttributeColumns"
          :key="String(attrKey)"
          class="col-header col-attribute sortable"
          :class="{ active: sortKey === attrKey }"
          @click="handleSort(attrKey)"
        >
          {{ attrKey.split('_').pop() }}
          <v-icon
            v-if="sortIcon(attrKey)"
            x-small
          >{{ sortIcon(attrKey) }}</v-icon>
        </span>
        <span
          v-if="columnVisibility?.notes"
          class="col-header col-notes sortable"
          :class="{ active: sortKey === 'notes' }"
          @click="handleSort('notes')"
        >
          Notes
          <v-icon
            v-if="sortIcon('notes')"
            x-small
          >{{ sortIcon('notes') }}</v-icon>
        </span>
        <v-spacer />
        <span class="col-header col-actions">Actions</span>
      </div>
    </div>
    <datalist id="allTypesOptions">
      <option
        v-for="type in allTypes"
        :key="String(type)"
        :value="type"
      >
        {{ type }}
      </option>
    </datalist>
    <v-virtual-scroll
      :ref="virtualListRef"
      v-mousetrap="mouseTrap"
      class="tracks-compact"
      :items="virtualListItems"
      :item-height="data.itemHeight"
      :height="virtualHeight"
      bench="1"
    >
      <template #default="{ item }">
        <track-item
          v-bind="getItemProps(item)"
          :lock-types="lockTypes"
          :disabled="disabled"
          :compact="true"
          :column-visibility="columnVisibility"
          :fps="fps"
          @seek="$emit('track-seek', $event)"
        />
      </template>
    </v-virtual-scroll>
  </div>
</template>
