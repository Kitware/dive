<script lang="ts">
import {
  defineComponent,
  PropType,
  ref,
  watch,
} from 'vue';

export default defineComponent({
  name: 'CalibrationDialog',
  props: {
    value: { type: Boolean, required: true },
    calibration: { type: Object, default: null },
  },
  setup(props, { emit }) {
    const close = () => emit('input', false);

    return {
      close,
    };
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    max-width="600px"
    scrollable
    @input="$emit('input', $event)"
  >
    <v-card v-if="calibration" class="rounded-lg">
      <v-toolbar flat color="primary" dark dense>
        <v-icon left>
          mdi-checkerboard
        </v-icon>
        <v-toolbar-title class="text-h6">
          Cameras calibration
        </v-toolbar-title>
        <v-spacer />
        <v-btn icon small @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>

      <v-card-text class="pa-4">
        <div class="mb-6">
          <div class="text-subtitle-1 font-weight-bold mb-2">General</div>
          <v-simple-table dense class="mb-4 elevation-1">
            <template v-slot:default>
              <thead>
                <tr>
                  <th class="text-left">Parameter</th>
                  <th class="text-left">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Image resolution</td><td>{{ calibration.image_width }} x {{ calibration.image_height }} px</td></tr>
                <tr><td>Calibration grid</td><td>{{ calibration.grid_width }} x {{ calibration.grid_height }}</td></tr>
                <tr><td>Square size</td><td>{{ calibration.square_size_mm }} mm</td></tr>
                <tr><td>Stereo RMS Error</td><td>{{ calibration.rms_error_stereo }}</td></tr>
              </tbody>
            </template>
          </v-simple-table>

          <div class="text-subtitle-1 font-weight-bold mb-2">Intrinsics</div>
          <v-simple-table dense class="mb-4 elevation-1">
            <template v-slot:default>
              <thead>
                <tr>
                  <th class="text-left">Property</th>
                  <th class="text-left">Left Camera</th>
                  <th class="text-left">Right Camera</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Focal (fx, fy)</strong></td>
                  <td>{{ calibration.fx_left }} , {{ calibration.fy_left }}</td>
                  <td>{{ calibration.fx_right }} , {{ calibration.fy_right }}</td>
                </tr>
                <tr>
                  <td><strong>Optical center (cx, cy)</strong></td>
                  <td>{{ calibration.cx_left }} , {{ calibration.cy_left }}</td>
                  <td>{{ calibration.cx_right }} , {{ calibration.cy_right }}</td>
                </tr>
                <tr>
                  <td><strong>Radial Distortion (k1, k2, k3)</strong></td>
                  <td>{{ calibration.k1_left }} , {{ calibration.k2_left }} , {{ calibration.k3_left }}</td>
                  <td>{{ calibration.k1_right }} , {{ calibration.k2_right }} , {{ calibration.k3_right }}</td>
                </tr>
                <tr>
                  <td><strong>Tangential Distortion (p1, p2)</strong></td>
                  <td>{{ calibration.p1_left }} , {{ calibration.p2_left }}</td>
                  <td>{{ calibration.p1_right }} , {{ calibration.p2_right }}</td>
                </tr>
                <tr>
                  <td><strong>RMS Error</strong></td>
                  <td>{{ calibration.rms_error_left }}</td>
                  <td>{{ calibration.rms_error_right }}</td>
                </tr>
              </tbody>
            </template>
          </v-simple-table>
          
          <div class="text-subtitle-1 font-weight-bold mb-2">Extrinsics</div>
          <v-row>
            <v-col cols="12" md="6">
              <v-card outlined class="pa-2 text-caption font-mono">
                <div class="font-weight-bold mb-1">Translation T (mm):</div>
                X: {{ calibration.T[0] }}<br>
                Y: {{ calibration.T[1] }}<br>
                Z: {{ calibration.T[2] }}
              </v-card>
            </v-col>
            <v-col cols="12" md="6">
              <v-card outlined class="pa-2 text-caption font-mono">
                <div class="font-weight-bold mb-1">Rotation R:</div>
                [{{ calibration.R[0].toFixed(4) }}, {{ calibration.R[1].toFixed(4) }}, {{ calibration.R[2].toFixed(4) }}]<br>
                [{{ calibration.R[3].toFixed(4) }}, {{ calibration.R[4].toFixed(4) }}, {{ calibration.R[5].toFixed(4) }}]<br>
                [{{ calibration.R[6].toFixed(4) }}, {{ calibration.R[7].toFixed(4) }}, {{ calibration.R[8].toFixed(4) }}]
              </v-card>
            </v-col>
          </v-row>
        </div>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4 lighten-3">
        <v-btn text color="grey darken-1" @click="close">
          Cancel
        </v-btn>
        <v-spacer />
        <v-btn color="red" outlined @click="close">
          <v-icon left>
            mdi-delete-outline
          </v-icon>
          Delete
        </v-btn>
        <v-btn color="primary" outlined @click="close">
          <v-icon left>
            mdi-upload
          </v-icon>
          Import
        </v-btn>
        <v-btn color="primary" @click="close">
          <v-icon left>
            mdi-download
          </v-icon>
          Download
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
