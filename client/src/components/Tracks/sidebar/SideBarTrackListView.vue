<script lang="ts">
import { defineComponent, computed } from 'vue';
import { clientSettings } from 'dive-common/store/settings';
import TrackItem from '../TrackItem.vue';
import DeleteAllScopeDialog from '../../DeleteAllScopeDialog.vue';
import TrackSettingsDialog from '../TrackSettingsDialog.vue';
import { useReadOnlyMode, useTrackFilters, useTrackStyleManager } from '../../../provides';

export default defineComponent({
  name: 'SideBarTrackListView',
  components: { TrackItem, DeleteAllScopeDialog, TrackSettingsDialog },
  props: {
    data: { type: Object, required: true },
    filteredTracks: { type: Array, required: true },
    newTrackMode: { type: String, required: true },
    newTrackType: { type: String, required: true },
    trackAdd: { type: Function, required: true },
    multiDelete: { type: Function, required: true },
    confirmDeleteAll: { type: Function, required: true },
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
    <v-subheader class="flex-grow-1 trackHeader px-2">
      <v-container class="py-2">
        <v-row align="center">
          Tracks ({{ filteredTracks.length }})
          <v-spacer />
          <TrackSettingsDialog v-model="data.settingsActive">
            <slot name="settings" />
          </TrackSettingsDialog>
          <v-tooltip open-delay="100" bottom>
            <template #activator="{ on }">
              <v-btn
                :disabled="filteredTracks.length === 0 || readOnlyMode"
                icon
                small
                class="mr-2"
                v-on="on"
                @click="multiDelete()"
              >
                <v-icon small color="error">
                  mdi-delete
                </v-icon>
              </v-btn>
            </template>
            <span>Delete visible items</span>
          </v-tooltip>
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
                class="mr-2"
                :color="newTrackColor"
                v-on="on"
                @click="trackAdd()"
              >
                <v-icon small>
                  mdi-plus
                </v-icon>
                {{ newTrackMode }}
              </v-btn>
            </template>
            <span>Default Type: {{ newTrackType }}</span>
          </v-tooltip>
        </v-row>
      </v-container>
    </v-subheader>
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
    <DeleteAllScopeDialog
      v-model="data.showDeleteAll"
      :scope.sync="data.deleteAllScope"
      lead="Every listed track is selected. Delete tracks that are:"
      @confirm="confirmDeleteAll()"
    />
  </div>
</template>
