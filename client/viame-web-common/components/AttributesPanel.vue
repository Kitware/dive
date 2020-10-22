<script lang="ts">
import {
  computed, defineComponent, onBeforeMount, ref,
} from '@vue/composition-api';

import { useSelectedTrackId, useFrame, useTrackMap } from 'vue-media-annotator/provides';
import Track, { TrackId, Feature } from 'vue-media-annotator/track';

import { useApi, Attribute } from 'viame-web-common/apispec';
import AttributeInput from 'viame-web-common/components/AttributeInput.vue';

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
  },

  setup() {
    const attributes = ref([] as Attribute[]);
    const trackMap = useTrackMap();
    const frameRef = useFrame();
    const selectedTrackIdRef = useSelectedTrackId();
    const { getAttributes } = useApi();
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

    onBeforeMount(async () => {
      attributes.value = await getAttributes();
    });

    return {
      selectedTrackIdRef,
      /* Attributes */
      detectionAttributes,
      trackAttributes,
      /* Selected */
      selectedDetection,
      selectedTrack,
      /* Update functions */
      updateFeatureAttribute,
      updateTrackAttribute,
    };
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
              selectedTrack
                ? selectedTrack.attributes[attribute.name]
                : undefined
            "
            @change="updateTrackAttribute(selectedTrackIdRef, $event)"
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
              (selectedDetection && selectedDetection.attributes)
                ? selectedDetection.attributes[attribute.name]
                : undefined
            "
            @change="updateFeatureAttribute(selectedTrackIdRef, selectedDetection, $event)"
          />
        </div>
      </template>
    </v-col>
  </v-row>
</template>
