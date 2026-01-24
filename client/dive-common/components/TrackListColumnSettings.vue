<script lang="ts">
import {
  defineComponent,
  computed,
  PropType,
} from 'vue';
import { clientSettings } from 'dive-common/store/settings';
import { Attribute } from 'vue-media-annotator/use/AttributeTypes';

export default defineComponent({
  name: 'TrackListColumnSettings',

  props: {
    attributes: {
      type: Array as PropType<Attribute[]>,
      default: () => [],
    },
    fps: {
      type: Number,
      default: null,
    },
  },

  setup(props) {
    const columnVisibility = computed(
      () => clientSettings.trackSettings.trackListSettings.columnVisibility,
    );

    const trackAttributes = computed(() => props.attributes.filter((a) => a.belongs === 'track'));
    const detectionAttributes = computed(() => props.attributes.filter((a) => a.belongs === 'detection'));

    const isAttributeEnabled = (key: string) => columnVisibility.value?.attributeColumns.includes(key) ?? false;

    const toggleAttribute = (key: string) => {
      if (!columnVisibility.value) return;
      const index = columnVisibility.value.attributeColumns.indexOf(key);
      if (index === -1) {
        columnVisibility.value.attributeColumns.push(key);
      } else {
        columnVisibility.value.attributeColumns.splice(index, 1);
      }
    };

    return {
      clientSettings,
      columnVisibility,
      trackAttributes,
      detectionAttributes,
      isAttributeEnabled,
      toggleAttribute,
    };
  },
});
</script>

<template>
  <v-card
    outlined
    class="pa-2"
    width="280"
    color="blue-grey darken-3"
  >
    <div class="subheading mb-2">
      Column Visibility
    </div>

    <!-- Built-in columns -->
    <div class="text-caption grey--text mb-1">
      Frame Columns
    </div>
    <v-checkbox
      v-model="columnVisibility.startFrame"
      dense
      hide-details
      label="Start Frame"
      class="my-0 py-0"
    />
    <v-checkbox
      v-model="columnVisibility.endFrame"
      dense
      hide-details
      label="End Frame"
      class="my-0 py-0"
    />

    <div class="text-caption grey--text mt-2 mb-1">
      Timestamp Columns
    </div>
    <v-checkbox
      v-model="columnVisibility.startTimestamp"
      dense
      hide-details
      label="Start Timestamp"
      class="my-0 py-0"
      :disabled="!fps"
    />
    <v-checkbox
      v-model="columnVisibility.endTimestamp"
      dense
      hide-details
      label="End Timestamp"
      class="my-0 py-0"
      :disabled="!fps"
    />
    <div
      v-if="!fps"
      class="text-caption orange--text ml-6"
    >
      Timestamps require FPS metadata
    </div>

    <!-- Attribute columns -->
    <template v-if="trackAttributes.length > 0">
      <v-divider class="my-2" />
      <div class="text-caption grey--text mb-1">
        Track Attributes
      </div>
      <v-checkbox
        v-for="attr in trackAttributes"
        :key="attr.key"
        :input-value="isAttributeEnabled(attr.key)"
        dense
        hide-details
        :label="attr.name"
        class="my-0 py-0"
        @change="toggleAttribute(attr.key)"
      />
    </template>

    <template v-if="detectionAttributes.length > 0">
      <v-divider class="my-2" />
      <div class="text-caption grey--text mb-1">
        Detection Attributes
      </div>
      <v-checkbox
        v-for="attr in detectionAttributes"
        :key="attr.key"
        :input-value="isAttributeEnabled(attr.key)"
        dense
        hide-details
        :label="attr.name"
        class="my-0 py-0"
        @change="toggleAttribute(attr.key)"
      />
    </template>

    <template v-if="trackAttributes.length === 0 && detectionAttributes.length === 0">
      <v-divider class="my-2" />
      <div class="text-caption grey--text">
        No attributes defined in this dataset
      </div>
    </template>

    <div class="text-caption grey--text mt-2 mb-1">
      Other Columns
    </div>
    <v-checkbox
      v-model="columnVisibility.notes"
      dense
      hide-details
      label="Notes"
      class="my-0 py-0"
    />
  </v-card>
</template>

<style scoped>
.subheading {
  font-weight: 600;
  font-size: 14px;
}
</style>
