<script lang="ts">
import { defineComponent, computed } from 'vue';
import { clientSettings } from 'dive-common/store/settings';
import TrackItem from '../TrackItem.vue';
import { useReadOnlyMode, useTrackFilters, useTrackStyleManager } from '../../../provides';

export default defineComponent({
  name: 'SideBarTrackListView',
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
    setVirtualListRef: { type: Function, required: true },
    mouseTrap: { type: Array, required: true },
    virtualHeight: { type: Number, required: true },
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
    return {
      readOnlyMode,
      allTypes,
      columnVisibility,
      newTrackColor,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <div class="trackHeader track-header-row px-2 py-2">
      <span class="track-header-title">Tracks ({{ filteredTracks.length }})</span>
      <div class="track-header-actions">
        <v-menu
          v-model="data.settingsActive"
          :close-on-content-click="false"
          location="bottom"
          :offset="[0, 28]"
        >
          <template #activator="{ props: activatorProps }">
            <v-btn
              icon
              size="small"
              v-bind="activatorProps"
            >
              <v-icon
                size="small"
                :color="data.settingsActive ? 'accent' : 'default'"
              >
                mdi-cog
              </v-icon>
            </v-btn>
          </template>
          <slot name="settings" />
        </v-menu>
        <v-tooltip
          open-delay="100"
          location="bottom"
        >
          <template #activator="{ props: activatorProps }">
            <v-btn
              :disabled="filteredTracks.length === 0 || readOnlyMode"
              icon
              size="small"
              v-bind="activatorProps"
              @click="multiDelete()"
            >
              <v-icon
                size="small"
                color="error"
              >
                mdi-delete
              </v-icon>
            </v-btn>
          </template>
          <span>Delete visible items</span>
        </v-tooltip>
        <v-tooltip
          open-delay="200"
          location="bottom"
          max-width="200"
        >
          <template #activator="{ props: activatorProps }">
            <v-btn
              class="add-track-btn"
              :disabled="readOnlyMode"
              variant="flat"
              size="x-small"
              :style="{ '--add-track-outline-color': newTrackColor || 'rgba(255, 255, 255, 0.45)' }"
              v-bind="activatorProps"
              @click="trackAdd()"
            >
              <v-icon size="small">
                mdi-plus
              </v-icon>
              {{ newTrackMode }}
            </v-btn>
          </template>
          <span>Default Type: {{ newTrackType }}</span>
        </v-tooltip>
      </div>
    </div>
    <datalist id="allTypesOptions">
      <option
        v-for="type in allTypes"
        :key="type"
        :value="type"
      >
        {{ type }}
      </option>
    </datalist>
    <v-virtual-scroll
      :ref="setVirtualListRef"
      v-mousetrap="mouseTrap"
      class="tracks"
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
          :compact="false"
          :column-visibility="columnVisibility"
          :fps="fps"
          @seek="$emit('track-seek', $event)"
        />
      </template>
    </v-virtual-scroll>
  </div>
</template>

<style scoped lang="scss">
.track-header-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.track-header-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-header-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;

  > * {
    flex-shrink: 0;
  }
}

.add-track-btn {
  background-color: #424242 !important;
  color: rgba(255, 255, 255, 0.87) !important;
  border: 1px solid var(--add-track-outline-color, rgba(255, 255, 255, 0.45)) !important;
  box-shadow: none !important;
}
</style>
