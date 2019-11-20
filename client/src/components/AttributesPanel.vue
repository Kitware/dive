<script>
export default {
  name: "AttributesPanel",
  props: {
    selectedDetection: {
      type: Object
    }
  },
  watch: {}
};
</script>

<template>
  <v-row class="attributes-panel flex-column" no-gutters>
    <v-col class="">
      <v-subheader>Track attributes</v-subheader>
      <div class="ml-4 body-2" style="line-height:22px;">
        <div v-if="!selectedDetection">No track selected</div>
        <template v-else>
          <div>Track ID: {{ selectedDetection.track }}</div>
          <div>Confidence pairs:</div>
          <div
            class="ml-3"
            v-for="(pair, index) in selectedDetection.confidencePairs"
            :key="index"
          >
            {{ pair[0] }}: {{ pair[1].toFixed(2) }}
          </div>
        </template>
      </div>
    </v-col>
    <v-col class="">
      <v-subheader>Detection attributes</v-subheader>
      <div class="ml-4 body-2" style="line-height:22px;">
        <div v-if="!selectedDetection">No detection selected</div>
        <template v-else>
          <div>Frame: {{ selectedDetection.frame }}</div>
          <div>Confidence: {{ selectedDetection.confidence }}</div>
          <div>Fish length: {{ selectedDetection.fishLength }}</div>
        </template>
      </div>
      <div class="detection"></div>
    </v-col>
  </v-row>
</template>

<style lang="scss" scoped>
.attributes-panel {
}
</style>
