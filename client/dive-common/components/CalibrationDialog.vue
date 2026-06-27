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
    sourceFileName: { type: String as PropType<string | undefined>, default: undefined },
    jsonFileName: { type: String as PropType<string | undefined>, default: undefined },
    showDownload: { type: Boolean, default: true },
    showDelete: { type: Boolean, default: true },
  },
  setup(props, { emit }) {
    const close = () => emit('input', false);

    const formatOptional = (value: number | undefined) => (
      value === undefined || value === null ? '' : String(value)
    );

    const formatPair = (first: number | undefined, second: number | undefined) => {
      const formattedFirst = formatOptional(first);
      const formattedSecond = formatOptional(second);
      if (!formattedFirst && !formattedSecond) {
        return '';
      }
      return `${formattedFirst} , ${formattedSecond}`;
    };

    const formatTriple = (
      first: number | undefined,
      second: number | undefined,
      third: number | undefined,
    ) => {
      const formattedFirst = formatOptional(first);
      const formattedSecond = formatOptional(second);
      const formattedThird = formatOptional(third);
      if (!formattedFirst && !formattedSecond && !formattedThird) {
        return '';
      }
      return `${formattedFirst} , ${formattedSecond} , ${formattedThird}`;
    };

    const formatResolution = (
      width: number | undefined,
      height: number | undefined,
    ) => {
      const formattedWidth = formatOptional(width);
      const formattedHeight = formatOptional(height);
      if (!formattedWidth && !formattedHeight) {
        return '';
      }
      return `${formattedWidth} x ${formattedHeight} px`;
    };

    const formatGrid = (width: number | undefined, height: number | undefined) => {
      const formattedWidth = formatOptional(width);
      const formattedHeight = formatOptional(height);
      if (!formattedWidth && !formattedHeight) {
        return '';
      }
      return `${formattedWidth} x ${formattedHeight}`;
    };

    const formatWithUnit = (value: number | undefined, unit: string) => {
      const formatted = formatOptional(value);
      return formatted ? `${formatted} ${unit}` : '';
    };

    const formatRotationRow = (rotation: number[] | undefined, start: number) => {
      if (!rotation || rotation.length < start + 3) {
        return '';
      }
      return `[${rotation[start].toFixed(4)}, ${rotation[start + 1].toFixed(4)}, ${rotation[start + 2].toFixed(4)}]`;
    };

    const formatTranslation = (translation: number[] | undefined, index: number) => {
      if (!translation || translation.length <= index) {
        return '';
      }
      return String(translation[index]);
    };

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
      formatOptional,
      formatPair,
      formatTriple,
      formatResolution,
      formatGrid,
      formatWithUnit,
      formatRotationRow,
      formatTranslation,
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
        <div v-if="sourceFileName || jsonFileName" class="mb-4">
          <div v-if="sourceFileName" class="mb-2">
            <span class="text-subtitle-1 font-weight-bold mr-2">Source file:</span>
            <span>{{ sourceFileName }}</span>
          </div>
          <div v-if="jsonFileName">
            <span class="text-subtitle-1 font-weight-bold mr-2">JSON file:</span>
            <span>{{ jsonFileName }}</span>
          </div>
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
                <tr><td>Image resolution</td><td>{{ formatResolution(calibration.imageWidth, calibration.imageHeight) }}</td></tr>
                <tr><td>Calibration grid</td><td>{{ formatGrid(calibration.gridWidth, calibration.gridHeight) }}</td></tr>
                <tr><td>Square size</td><td>{{ formatWithUnit(calibration.squareSize, 'mm') }}</td></tr>
                <tr><td>Stereo RMS Error</td><td>{{ formatOptional(calibration.rmsError) }}</td></tr>
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
                    {{ formatPair(calib.fx, calib.fy) }}
                  </td>
                </tr>
                <tr>
                  <td><strong>Optical center (cx, cy)</strong></td>
                  <td v-for="(calib, cameraName) in calibration.calibrations" :key="cameraName">
                    {{ formatPair(calib.cx, calib.cy) }}
                  </td>
                </tr>
                <tr>
                  <td><strong>Radial Distortion (k1, k2, k3)</strong></td>
                  <td v-for="(calib, cameraName) in calibration.calibrations" :key="cameraName">
                    {{ formatTriple(calib.k1, calib.k2, calib.k3) }}
                  </td>
                </tr>
                <tr>
                  <td><strong>Tangential Distortion (p1, p2)</strong></td>
                  <td v-for="(calib, cameraName) in calibration.calibrations" :key="cameraName">
                    {{ formatPair(calib.p1, calib.p2) }}
                  </td>
                </tr>
                <tr>
                  <td><strong>RMS Error</strong></td>
                  <td v-for="(calib, cameraName) in calibration.calibrations" :key="cameraName">
                    {{ formatOptional(calib.rmsError) }}
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
                X: {{ formatTranslation(calibration.T, 0) }}<br>
                Y: {{ formatTranslation(calibration.T, 1) }}<br>
                Z: {{ formatTranslation(calibration.T, 2) }}
              </v-card>
            </v-col>
            <v-col cols="12" md="6">
              <v-card outlined class="pa-2 text-caption font-mono">
                <div class="font-weight-bold mb-1">
                  Rotation R:
                </div>
                {{ formatRotationRow(calibration.R, 0) }}<br>
                {{ formatRotationRow(calibration.R, 3) }}<br>
                {{ formatRotationRow(calibration.R, 6) }}
              </v-card>
            </v-col>
          </v-row>
        </div>
        <div v-else-if="sourceFileName || jsonFileName">
          <div class="text-subtitle-1 font-weight-bold mb-2">
            Calibration Not Ready
          </div>
          <div>
            A calibration file is linked, but its JSON parameters are not available yet.
            Conversion to the JSON camera-rig format may still be running.
          </div>
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
        <v-btn v-if="(sourceFileName || jsonFileName) && showDelete" color="red" outlined @click="deleteCalibration">
          <v-icon left>
            mdi-delete-outline
          </v-icon>
          Delete
        </v-btn>
        <v-btn v-if="(sourceFileName || jsonFileName) && showDownload" color="primary" @click="downloadCalibration">
          <v-icon left>
            mdi-download
          </v-icon>
          Download
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
