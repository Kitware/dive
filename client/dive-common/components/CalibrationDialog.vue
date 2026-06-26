<script lang="ts">
import { DatasetStereoCalibration } from 'dive-common/apispec';
import {
  defineComponent,
  PropType,
} from 'vue';

export default defineComponent({
  name: 'CalibrationDialog',
  props: {
    value: { type: Boolean, required: true },
    calibration: { type: Object as PropType<DatasetStereoCalibration | undefined>, default: undefined },
    fileName: { type: String as PropType<string | undefined>, default: undefined },
    showDownload: { type: Boolean, default: true },
    showDelete: { type: Boolean, default: true },
  },
  setup(props, { emit }) {
    const close = () => emit('input', false);

    const downloadCalibration = () => {
      emit('download');
      close();
    };

    const deleteCalibration = () => {
      emit('delete');
    };

    return {
      close,
      downloadCalibration,
      deleteCalibration,
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
    <v-card class="rounded-lg">
      <v-toolbar flat color="primary" dark dense>
        <v-icon left>
          mdi-checkerboard
        </v-icon>
        <v-toolbar-title class="text-h6">
          Camera Calibration Information
        </v-toolbar-title>
        <v-spacer />
        <v-btn icon small @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>

      <v-card-text class="pa-4">
        <div v-if="fileName" class="mb-4">
          <span class="text-subtitle-1 font-weight-bold mr-2">File:</span>
          <span>{{ fileName }}</span>
        </div>
        <div v-if="calibration" class="mb-6">
          <div class="text-subtitle-1 font-weight-bold mb-2">
            General
          </div>
          <v-simple-table dense class="mb-4 elevation-1">
            <template #default>
              <thead>
                <tr>
                  <th class="text-left">
                    Parameter
                  </th>
                  <th class="text-left">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Image resolution</td><td>{{ calibration.imageWidth }} x {{ calibration.imageHeight }} px</td></tr>
                <tr><td>Calibration grid</td><td>{{ calibration.gridWidth }} x {{ calibration.gridHeight }}</td></tr>
                <tr><td>Square size</td><td>{{ calibration.squareSize }} mm</td></tr>
                <tr><td>Stereo RMS Error</td><td>{{ calibration.rmsError }}</td></tr>
              </tbody>
            </template>
          </v-simple-table>

          <div class="text-subtitle-1 font-weight-bold mb-2">
            Intrinsics
          </div>
          <v-simple-table dense class="mb-4 elevation-1">
            <template #default>
              <thead>
                <tr>
                  <th class="text-left">
                    Property
                  </th>
                  <th v-for="(_, cameraName) in calibration.calibrations" :key="cameraName" class="text-left">
                    {{ cameraName }} camera
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Focal (fx, fy)</strong></td>
                  <td v-for="(calib, cameraName) in calibration.calibrations" :key="cameraName">
                    {{ calib.fx }} , {{ calib.fy }}
                  </td>
                </tr>
                <tr>
                  <td><strong>Optical center (cx, cy)</strong></td>
                  <td v-for="(calib, cameraName) in calibration.calibrations" :key="cameraName">
                    {{ calib.cx }} , {{ calib.cy }}
                  </td>
                </tr>
                <tr>
                  <td><strong>Radial Distortion (k1, k2, k3)</strong></td>
                  <td v-for="(calib, cameraName) in calibration.calibrations" :key="cameraName">
                    {{ calib.k1 }} , {{ calib.k2 }} , {{ calib.k3 }}
                  </td>
                </tr>
                <tr>
                  <td><strong>Tangential Distortion (p1, p2)</strong></td>
                  <td v-for="(calib, cameraName) in calibration.calibrations" :key="cameraName">
                    {{ calib.p1 }} , {{ calib.p2 }}
                  </td>
                </tr>
                <tr>
                  <td><strong>RMS Error</strong></td>
                  <td v-for="(calib, cameraName) in calibration.calibrations" :key="cameraName">
                    {{ calib.rmsError }}
                  </td>
                </tr>
              </tbody>
            </template>
          </v-simple-table>

          <div class="text-subtitle-1 font-weight-bold mb-2">
            Extrinsics
          </div>
          <v-row>
            <v-col cols="12" md="6">
              <v-card outlined class="pa-2 text-caption font-mono">
                <div class="font-weight-bold mb-1">
                  Translation T (mm):
                </div>
                X: {{ calibration.T[0] }}<br>
                Y: {{ calibration.T[1] }}<br>
                Z: {{ calibration.T[2] }}
              </v-card>
            </v-col>
            <v-col cols="12" md="6">
              <v-card outlined class="pa-2 text-caption font-mono">
                <div class="font-weight-bold mb-1">
                  Rotation R:
                </div>
                [{{ calibration.R[0].toFixed(4) }}, {{ calibration.R[1].toFixed(4) }}, {{ calibration.R[2].toFixed(4) }}]<br>
                [{{ calibration.R[3].toFixed(4) }}, {{ calibration.R[4].toFixed(4) }}, {{ calibration.R[5].toFixed(4) }}]<br>
                [{{ calibration.R[6].toFixed(4) }}, {{ calibration.R[7].toFixed(4) }}, {{ calibration.R[8].toFixed(4) }}]
              </v-card>
            </v-col>
          </v-row>
        </div>
        <div v-else>
          <div class="text-subtitle-1 font-weight-bold mb-2">
            No Calibration Loaded
          </div>
          <div>
            Calibration is needed to run many stereoscopic pipelines.
            <br>
            <br>
            You can import a calibration file manually via the Import button, or run a calibration pipeline on a checkerboard image sequence or video.
          </div>
        </div>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4 lighten-3">
        <v-btn text color="grey darken-1" @click="close">
          Cancel
        </v-btn>
        <v-spacer />
        <v-btn v-if="fileName && showDelete" color="red" outlined @click="deleteCalibration">
          <v-icon left>
            mdi-delete-outline
          </v-icon>
          Delete
        </v-btn>
        <v-btn v-if="fileName && showDownload" color="primary" @click="downloadCalibration">
          <v-icon left>
            mdi-download
          </v-icon>
          Download
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
