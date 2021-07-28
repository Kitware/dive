<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';
import { getSummary, SummaryItem } from 'platform/web-girder/api/summary.service';
import ColorHash from 'color-hash';

export default defineComponent({
  setup() {
    const summary = ref([] as SummaryItem[]);
    getSummary().then((r) => { summary.value = r; });
    const colorHash = new ColorHash({ lightness: [0.2, 0.3, 0.5] });
    return {
      colorHash,
      summary,
    };
  },
});
</script>

<template>
  <v-container>
    <v-card>
      <v-card-title class="text-h4">
        Published Annotation Data
      </v-card-title>
      <v-card-text class="text-subtitle-1">
        Summary information for the annotated labels across all datasets located in the root
        level Training Data folder. To publish your imagery to this folder and have it
        included in this summary, please contact
        <a href="mailto:viame-web@kitware.com">viame-web@kitware.com</a>.
      </v-card-text>
      <v-card-text>
        <table>
          <tr style="height:50px;">
            <th>Label</th>
            <th>Track Total Count</th>
            <th>Detection Total Count</th>
            <th>Viewer Links</th>
          </tr>
          <tr
            v-for="item in summary"
            :key="item.value"
          >
            <td>
              {{ item.value }}
            </td>
            <td>
              {{ item.total_tracks }}
            </td>
            <td>
              {{ item.total_detections }}
            </td>
            <td>
              <v-btn
                v-for="datasetId in item.found_in"
                :key="datasetId"
                x-small
                depressed
                :color="colorHash.hex(datasetId.slice(-4))"
                class="mr-1 my-1 white--text"
                :to="{ name: 'viewer', params: { id: datasetId } }"
              >
                <pre>{{ datasetId.slice(-4) }}</pre>
              </v-btn>
            </td>
          </tr>
        </table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style lang="scss" scoped>
@import 'dive-common/components/styles/KeyValueTable.scss';
</style>
