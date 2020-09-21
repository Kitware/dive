<script lang="ts">
import { Ref } from '@vue/composition-api';
import Vue, { PropType } from 'vue';

import Track, { TrackId, Feature } from 'vue-media-annotator/track';

import { getAttributes, Attribute } from 'app/api/viame.service';
import AttributeInput from 'app/components/AttributeInput.vue';

function getTrack(trackMap: Map<TrackId, Track>, trackId: TrackId): Track {
  const track = trackMap.get(trackId);
  if (track === undefined) {
    throw new Error(`Track ${trackId} missing from map`);
  }
  return track;
}

export default Vue.extend({
  components: {
    AttributeInput,
  },

  props: {
    trackMap: {
      type: Map as PropType<Map<TrackId, Track>>,
      required: true,
    },
    selectedTrackId: {
      type: Object as PropType<Ref<TrackId>>,
      required: true,
    },
    frame: {
      type: Object as PropType<Ref<number>>,
      required: true,
    },
  },

  data: () => ({
    attributes: [] as Attribute[],
  }),

  computed: {
    trackAttributes() {
      if (!this.attributes) {
        return [];
      }
      return this.attributes.filter(
        (attribute) => attribute.belongs === 'track',
      );
    },
    detectionAttributes() {
      if (!this.attributes) {
        return [];
      }
      return this.attributes.filter(
        (attribute) => attribute.belongs === 'detection',
      );
    },
    selectedTrack() {
      const trackId = this.selectedTrackId.value;
      if (trackId !== null) {
        const track = getTrack(this.trackMap, trackId);
        return {
          trackId: track.trackId,
          confidencePairs: track.confidencePairs,
          attributes: track.attributes,
        };
      }
      return null;
    },
    selectedDetection() {
      const trackId = this.selectedTrackId.value;
      const frame = this.frame.value;
      if (trackId !== null) {
        const track = getTrack(this.trackMap, trackId);
        const [feature] = track.getFeature(frame);
        return feature;
      }
      return null;
    },
  },

  async created() {
    this.attributes = await getAttributes();
  },

  methods: {
    updateTrackAttribute(
      trackId: TrackId,
      { name, value }: { name: string; value: unknown },
    ) {
      const track = getTrack(this.trackMap, trackId);
      track.setAttribute(name, value);
    },
    updateFeatureAttribute(
      trackId: TrackId,
      oldFeature: Feature,
      { name, value }: { name: string; value: unknown },
    ) {
      const track = getTrack(this.trackMap, trackId);
      track.setFeatureAttribute(oldFeature.frame, name, value);
    },
  },
});
</script>

<template>
  <v-row
    class="attributes-panel flex-column"
    no-gutters
  >
    <v-col
      class="flex-shrink-1"
      style="overflow-y: auto;"
    >
      <v-subheader>Track attributes</v-subheader>
      <div
        v-if="!selectedTrack"
        class="ml-4 body-2"
      >
        No track selected
      </div>
      <template v-else>
        <div
          class="mx-4 body-2"
          style="line-height:22px;"
        >
          <div>Track ID: {{ selectedTrack.trackId }}</div>
          <div>
            Confidence pairs:
            <div
              v-for="(pair, index) in selectedTrack.confidencePairs"
              :key="index"
              class="ml-3"
            >
              {{ pair[0] }}: {{ pair[1].toFixed(2) }}
            </div>
            <div v-if="Object.keys(selectedTrack.attributes).length">
              <br>
              Attributes:
              <div
                v-for="(pair, index) in selectedTrack.attributes"
                :key="index"
                class="ml-3"
              >
                {{ index }}: {{ pair }}
              </div>
            </div>
          </div>
          <AttributeInput
            v-for="(attribute, i) of trackAttributes"
            :key="i"
            :datatype="attribute.datatype"
            :name="attribute.name"
            :values="attribute.values ? attribute.values : null"
            :value="
              selectedTrack.trackAttributes
                ? selectedTrack.trackAttributes[attribute.name]
                : undefined
            "
            @change="updateTrackAttribute(selectedTrackId.value, $event)"
          />
        </div>
      </template>
    </v-col>
    <v-col style="overflow-y: auto;">
      <v-subheader>Detection attributes</v-subheader>
      <div
        v-if="!selectedDetection"
        class="ml-4 body-2"
      >
        No detection selected
      </div>
      <template v-else>
        <div
          class="mx-4 body-2"
          style="line-height:22px;"
        >
          <div>Frame: {{ selectedDetection.frame }}</div>
          <div v-if="selectedDetection.confidence">
            Confidence: {{ selectedDetection.confidence }}
          </div>
          <div v-if="selectedDetection.fishLength">
            Fish length: {{ selectedDetection.fishLength }}
          </div>
          <AttributeInput
            v-for="(attribute, i) of detectionAttributes"
            :key="i"
            :datatype="attribute.datatype"
            :name="attribute.name"
            :values="attribute.values ? attribute.values : null"
            :value="
              selectedDetection.attributes
                ? selectedDetection.attributes[attribute.name]
                : undefined
            "
            @change="updateFeatureAttribute(selectedTrackId.value, selectedDetection, $event)"
          />
        </div>
      </template>
    </v-col>
  </v-row>
</template>
