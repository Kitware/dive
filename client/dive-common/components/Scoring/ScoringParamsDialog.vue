<script lang="ts">
import { defineComponent } from 'vue';
import { useScoring } from 'dive-common/use/useScoring';
import { FILTER_ESTIMATORS } from 'dive-common/scoring/metrics';

export default defineComponent({
  name: 'ScoringParamsDialog',
  props: {
    value: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const scoring = useScoring();
    return {
      params: scoring.params,
      resetParams: scoring.resetParams,
      FILTER_ESTIMATORS,
      matchModes: [
        { value: 'box', text: 'Bounding boxes' },
        { value: 'polygon', text: 'Polygons where both sides have one' },
      ],
    };
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    max-width="720"
    scrollable
    @input="$emit('input', $event)"
  >
    <v-card outlined>
      <v-card-title class="text-h6">
        Scoring parameters
      </v-card-title>
      <v-card-text>
        <div class="section-title">
          Matching
        </div>
        <v-row dense>
          <v-col cols="6">
            <v-text-field
              v-model.number="params.iouThreshold"
              type="number"
              min="0"
              max="1"
              step="0.05"
              label="IoU threshold"
              hint="Overlap needed for a computed object to match a truth object"
              persistent-hint
              dense
              outlined
            />
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-model.number="params.confidenceThreshold"
              type="number"
              min="0"
              max="1"
              step="0.05"
              label="Confidence threshold"
              hint="Computed objects below this are ignored; 0 keeps everything for the curves"
              persistent-hint
              dense
              outlined
            />
          </v-col>
          <v-col cols="6">
            <v-select
              v-model="params.matchMode"
              :items="matchModes"
              label="Match on"
              hint="Polygon matching scores segmentations; boxes are used for any pair without polygons"
              persistent-hint
              dense
              outlined
            />
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-model.number="params.keypointThreshold"
              type="number"
              min="0"
              max="1"
              step="0.05"
              label="Keypoint tolerance"
              hint="Head/tail points within this fraction of the truth length count as correct"
              persistent-hint
              dense
              outlined
            />
          </v-col>
        </v-row>
        <div class="section-title">
          Classes
        </div>
        <v-row dense>
          <v-col cols="4">
            <v-switch
              v-model="params.perClass"
              label="Per class"
              hint="Report every class separately (needed for per-class curves and filters)"
              persistent-hint
              dense
            />
          </v-col>
          <v-col cols="4">
            <v-switch
              v-model="params.topClass"
              label="Top class only"
              hint="Offer each detection only to its highest scoring class"
              persistent-hint
              dense
            />
          </v-col>
          <v-col cols="4">
            <v-switch
              v-model="params.auxConfidence"
              label="Detection confidence"
              hint="Rank on the detection confidence rather than the class score"
              persistent-hint
              dense
            />
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-model="params.defaultLabel"
              label="Default class"
              hint="Class reported for objects that carry none"
              persistent-hint
              dense
              outlined
            />
          </v-col>
          <v-col cols="12">
            <v-textarea
              v-model="params.labelSynonyms"
              label="Class synonyms"
              hint="One class per line as 'canonical: alias, alias', so differing vocabularies score together"
              persistent-hint
              rows="2"
              dense
              outlined
            />
          </v-col>
        </v-row>
        <div class="section-title">
          Tracking and sweep
        </div>
        <v-row dense>
          <v-col cols="4">
            <v-switch
              v-model="params.tracking"
              label="Track metrics"
              hint="MOTA, HOTA, IDF1 and the KWANT metrics"
              persistent-hint
              dense
            />
          </v-col>
          <v-col cols="4">
            <v-switch
              v-model="params.sweep"
              label="Sweep thresholds"
              hint="Score at many confidence thresholds to find the best operating point"
              persistent-hint
              dense
            />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model.number="params.sweepInterval"
              type="number"
              min="2"
              max="200"
              step="1"
              label="Sweep steps"
              hint="Thresholds between 0 and 1; more steps take longer"
              persistent-hint
              dense
              outlined
              :disabled="!params.sweep"
            />
          </v-col>
          <v-col cols="12">
            <v-select
              v-model="params.filterEstimator"
              :items="FILTER_ESTIMATORS"
              label="Recommended filter from the sweep"
              dense
              outlined
              hide-details
              :disabled="!params.sweep"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-btn
          text
          @click="resetParams"
        >
          Reset to defaults
        </v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          @click="$emit('input', false)"
        >
          Done
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style lang="scss" scoped>
.section-title {
  font-weight: bold;
  color: #ccc;
  border-bottom: 1px solid #444;
  margin: 10px 0 6px;
}
</style>
