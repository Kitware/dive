<script>
import _ from 'lodash';
import { mapState } from 'vuex';
import * as d3 from 'd3';
import colors from 'vuetify/lib/util/colors';

import { getPathFromLocation } from '@/utils';

export default {
  name: 'Viewer',
  data: () => ({
    dataset: null,
    detections: null,
    selectedTrackId: null,
    checkedTracks: [],
    checkedTypes: [],
    confidence: 0.1,
    showTrackView: false,
    editingTrack: null,
    attributeEditing: false,
    frame: null,
    pendingSave: false,
    featurePointing: false,
    featurePointTarget: 'head',
  }),
  computed: {
    ...mapState(['location']),

    imageUrls() {
      if (!this.items) {
        return null;
      }

      return this.items
        .filter((item) => {
          const name = item.name.toLowerCase();
          return (
            name.endsWith('png')
            || name.endsWith('jpeg')
            || name.endsWith('jpg')
          );
        })
        .map((item) => `api/v1/item/${item._id}/download`);
    },
    frameRate() {
      if (!this.dataset) {
        return null;
      }
      return this.dataset.meta.fps;
    },
    annotationData() {
      if (!this.filteredDetections) {
        return null;
      }
      return this.filteredDetections.map((detection) => ({
        detection,
        frame: detection.frame,
        polygon: boundToGeojson(detection.bounds),
      }));
    },
    annotationStyle() {
      const { selectedTrackId } = this;
      const { editingTrack } = this;
      return {
        strokeColor: (a, b, data) => {
          if (data.record.detection.track === selectedTrackId) {
            return this.$vuetify.theme.themes.dark.accent;
          }
          if (data.record.detection.confidencePairs.length) {
            return typeColorMap(data.record.detection.confidencePairs[0][0]);
          }
          return typeColorMap.range()[0];
        },
        strokeOpacity: (a, b, data) => (data.record.detection.track === editingTrack ? 0.5 : 1),
        strokeWidth: (a, b, data) => (data.record.detection.track === selectedTrackId ? 4 : 1),
      };
    },
    textData() {
      if (!this.filteredDetections) {
        return null;
      }
      const data = [];
      this.filteredDetections.forEach((detection) => {
        const { bounds } = detection;
        if (!detection.confidencePairs) {
          return;
        }
        detection.confidencePairs
          .filter((pair) => pair[1] >= this.confidence)
          .forEach(([type, confidence], i) => {
            data.push({
              detection,
              frame: detection.frame,
              text: `${type}: ${confidence.toFixed(2)}`,
              x: bounds[1],
              y: bounds[2],
              offsetY: i * 14,
            });
          });
      });
      return data;
    },
    textStyle() {
      const { selectedTrackId } = this;
      return {
        color: (data) => {
          if (data.detection.track === selectedTrackId) {
            return this.$vuetify.theme.themes.dark.accent;
          }
          return typeColorMap(data.detection.confidencePairs[0][0]);
        },
        offsetY(data) {
          return data.offsetY;
        },
      };
    },
    markerData() {
      if (!this.filteredDetections) {
        return null;
      }
      const data = [];
      this.filteredDetections.forEach((detection) => {
        Object.entries(detection.features).forEach(([key, value]) => {
          data.push({
            detection,
            frame: detection.frame,
            feature: key,
            x: value[0],
            y: value[1],
          });
        });
      });
      return data;
    },
    markerStyle() {
      const { selectedTrackId } = this;
      return {
        fillColor: (data) => (data.feature === 'head' ? 'orange' : 'blue'),
        radius: 4,
        stroke: (data) => data.detection.track === selectedTrackId,
        strokeColor: this.$vuetify.theme.themes.dark.accent,
      };
    },
    lineChartData() {
      if (!this.filteredDetections) {
        return null;
      }
      const types = new Map();
      const total = new Map();
      this.filteredDetections.forEach((detection) => {
        const { frame } = detection;
        total.set(frame, total.get(frame) + 1 || 1);
        if (!detection.confidencePairs.length) {
          return;
        }
        const type = detection.confidencePairs[0][0];
        let typeCounter = types.get(type);
        if (!typeCounter) {
          typeCounter = new Map();
          types.set(type, typeCounter);
        }
        typeCounter.set(frame, typeCounter.get(frame) + 1 || 1);
      });
      return [
        {
          values: Array.from(total.entries()).sort((a, b) => a[0] - b[0]),
          color: 'lime',
          name: 'Total',
        },
        ...Array.from(types.entries()).map(([type, counter]) => ({
          values: Array.from(counter.entries()).sort((a, b) => a[0] - b[0]),
          name: type,
          color: typeColorMap(type),
        })),
      ];
    },
    eventChartData() {
      if (!this.filteredDetections) {
        return [];
      }
      return Object.entries(
        _.groupBy(this.filteredDetections, (detection) => detection.track),
      )
        .filter(([, detections]) => detections[0].confidencePairs.length)
        .map(([name, detections]) => {
          const range = [
            _.minBy(detections, (detection) => detection.frame).frame,
            _.maxBy(detections, (detection) => detection.frame).frame,
          ];
          return {
            track: detections[0].track,
            name: `Track ${name}`,
            color: typeColorMap(detections[0].confidencePairs[0][0]),
            selected: detections[0].track === this.selectedTrackId,
            range,
          };
        });
    },
    tracks() {
      if (!this.detections) {
        return [];
      }
      const tracks = Object.entries(
        _.groupBy(this.detections, (detection) => detection.track),
      ).map(([, detections]) => {
        const { confidencePairs } = detections[0];
        const detectionWithTrackAttribute = detections.find(
          (detection) => detection.trackAttributes,
        );

        return {
          trackId: detections[0].track,
          confidencePairs,
          trackAttributes: detectionWithTrackAttribute
            ? detectionWithTrackAttribute.trackAttributes
            : null,
        };
      });
      return _.sortBy(tracks, (track) => track.trackId);
    },
    types() {
      if (!this.tracks) {
        return [];
      }
      const typeSet = new Set();
      for (const { confidencePairs } of this.tracks) {
        for (const pair of confidencePairs) {
          typeSet.add(pair[0]);
        }
      }
      return Array.from(typeSet);
    },
    selectedDetection() {
      if (this.selectedTrackId === null || this.frame === null) {
        return null;
      }
      return this.detections.find(
        (detection) => detection.track === this.selectedTrackId
          && detection.frame === this.frame,
      );
    },
    selectedTrack() {
      if (this.selectedTrackId === null) {
        return null;
      }
      return this.tracks.find((track) => track.trackId === this.selectedTrackId);
    },
    editingDetection() {
      if (this.editingTrack == null || this.frame == null) {
        return null;
      }
      return this.detections.find(
        (detection) => detection.track === this.editingTrack
          && detection.frame === this.frame,
      );
    },
    editingDetectionGeojson() {
      if (!this.editingDetection) {
        return null;
      }
      return boundToGeojson(this.editingDetection.bounds);
    },
  },
  asyncComputed: {
    async items() {
      if (!this.dataset) {
        return null;
      }
      const { data: items } = await this.girderRest.get('item/', {
        params: { folderId: this.dataset._id, limit: 200000 },
      });
      return items;
    },
    async videoUrl() {
      if (!this.dataset || this.dataset.meta.type !== 'video') {
        return null;
      }
      const { data: clipMeta } = await this.girderRest.get(
        'viame_detection/clip_meta',
        {
          params: {
            folderId: this.dataset._id,
          },
        },
      );
      if (!clipMeta.video) {
        return null;
      }
      const { data: files } = await this.girderRest.get(
        `item/${clipMeta.video._id}/files`,
      );
      if (!files[0]) {
        return null;
      }
      return `api/v1/file/${files[0]._id}/download`;
    },
  },
  watch: {
    imageUrls(val) {
      if (!val.length) {
        this.$snackbar({
          text: 'No images found',
          timeout: 4500,
        });
      }
    },
    detections() {
      this.updatecheckedTracksAndTypes();
    },
  },

  methods: {
    typeColorMap,
    getPathFromLocation,
    /* TODO: DANGER: reaching into refs like this is highly non-standard */
    seek(frame) {
      this.$refs.playbackComponent.provided.$emit('seek', frame);
    },
    nextFrame() {
      this.$refs.playbackComponent.provided.$emit('next-frame');
    },
    prevFrame() {
      this.$refs.playbackComponent.provided.$emit('next-frame');
    },
    /* END TODO */

    annotationClick(data) {
      if (!this.featurePointing) {
        this.selectTrack(data.detection.track);
      }
    },
    clickTrack(track) {
      this.selectTrack(track.trackId);
    },
    selectTrack(track) {
      if (this.editingTrack !== null) {
        this.editingTrack = null;
        return;
      }
      this.selectedTrackId = this.selectedTrackId === track ? null : track;
    },
    updatecheckedTracksAndTypes() {
      if (!this.tracks) {
        return;
      }
      this.checkedTracks = this.tracks.map((track) => track.trackId);
      this.checkedTypes = this.types;
    },
    gotoTrackFirstFrame(track) {
      this.selectedTrackId = track.trackId;
      const frame = this.eventChartData.find((d) => d.track === track.trackId)
        .range[0];
      this.seek(frame);
    },
    async deleteTrack(track) {
      const result = await this.$prompt({
        title: 'Confirm',
        text: `Please confirm to delete track ${track.trackId}`,
        confirm: true,
      });
      if (!result) {
        return;
      }
      this.pendingSave = true;
      this.detections
        .filter((detection) => detection.track === track.trackId)
        .forEach((detection) => {
          this.detections.splice(this.detections.indexOf(detection), 1);
        });
    },
    annotationRightClick(data) {
      this.editTrack(data.detection.track);
    },
    editTrack(track) {
      this.editingTrack = track;
    },
    addTrack() {
      this.editingTrack = this.tracks.length
        ? this.tracks.slice(-1)[0].trackId + 1
        : 1;
    },


    detectionChanged(feature) {
      if (this.editingTrack === null) {
        return;
      }
      this.pendingSave = true;
      const bounds = feature.type === 'Feature'
        ? geojsonToBound2(feature.geometry)
        : geojsonToBound(feature);
      let confidencePairs = [];
      const trackMeta = this.tracks.find(
        (track) => track.trackId === this.editingTrack,
      );
      if (trackMeta) {
        confidencePairs = trackMeta.confidencePairs;
      }
      if (this.editingDetection) {
        const detectionToChange = this.editingDetection;
        this.detections.splice(this.detections.indexOf(detectionToChange), 1);
        this.detections.push(
          Object.freeze({
            ...detectionToChange,
            ...{
              track: this.editingTrack,
              confidencePairs,
              frame: this.frame,
              features: {},
              bounds,
            },
          }),
        );
      } else {
        this.detections.push(
          Object.freeze({
            track: this.editingTrack,
            confidencePairs,
            frame: this.frame,
            features: {},
            confidence: 1,
            fishLength: -1,
            attributes: null,
            trackAttributes: null,
            bounds,
          }),
        );
      }
    },
    trackTypeChange(track, type) {
      const { detections } = this;
      detections
        .filter((detection) => detection.track === track.trackId)
        .forEach((detection) => {
          const index = detections.indexOf(detection);
          detections.splice(index, 1);
          detections.push({
            ...detection,
            ...{
              confidence: 1,
              confidencePairs: [[type, 1]],
            },
          });
        });
      this.pendingSave = true;
    },
    attributeChange({ type, name, value }) {
      if (type === 'track') {
        this.trackAttributeChange_(name, value);
      } else if (type === 'detection') {
        this.detectionAttributeChange_(name, value);
      }
      this.pendingSave = true;
    },
    trackAttributeChange_(name, value) {
      const { selectedTrack } = this;
      let detectionToChange = null;
      if (selectedTrack.trackAttributes) {
        detectionToChange = this.detections.find(
          (detection) => detection.track === selectedTrack.trackId
            && detection.trackAttributes,
        );
      } else {
        detectionToChange = this.detections.find(
          (detection) => detection.track === selectedTrack.trackId,
        );
      }
      const trackAttributes = {
        ...detectionToChange.trackAttributes,
        [name]: value,
      };
      this.detections.splice(this.detections.indexOf(detectionToChange), 1);
      this.detections.push(
        Object.freeze({
          ...detectionToChange,
          trackAttributes,
        }),
      );
    },
    detectionAttributeChange_(name, value) {
      const detectionToChange = this.selectedDetection;
      const attributes = {
        ...detectionToChange.attributes,
        [name]: value,
      };
      this.detections.splice(this.detections.indexOf(detectionToChange), 1);
      this.detections.push(
        Object.freeze({
          ...detectionToChange,
          attributes,
        }),
      );
    },
  },
};


function geojsonToBound(geojson) {
  const coords = geojson.coordinates[0];
  return [coords[0][0], coords[1][0], coords[0][1], coords[2][1]];
}

function geojsonToBound2(geojson) {
  const coords = geojson.coordinates[0];
  return [coords[0][0], coords[2][0], coords[1][1], coords[0][1]];
}
</script>

<template>
  <v-content class="viewer">
    <v-app-bar app>
      <NavigationTitle />
      <v-tabs
        icons-and-text
        hide-slider
        style="flex-basis:0; flex-grow:0;"
      >
        <v-tab
          :to="getPathFromLocation(location)"
        >
          Data<v-icon>mdi-database</v-icon>
        </v-tab>
      </v-tabs>
      <span
        class="subtitle-1 text-center"
        style="flex-grow: 1;"
      >{{
        dataset ? dataset.name : ""
      }}</span>
      <ConfidenceFilter :confidence.sync="confidence" />
      <v-btn
        icon
        :disabled="!pendingSave"
        @click="save"
      >
        <v-icon>mdi-content-save</v-icon>
      </v-btn>
    </v-app-bar>
    <v-row
      no-gutters
      class="fill-height"
    >
      <v-card
        width="300"
        style="z-index:1;"
      >
        <v-btn
          v-mousetrap="[
            {
              bind: 'a',
              handler: () => {
                attributeEditing = !attributeEditing;
              }
            }
          ]"
          icon
          class="swap-button"
          title="A key"
          @click="attributeEditing = !attributeEditing"
        >
          <v-icon>mdi-swap-horizontal</v-icon>
        </v-btn>
        <v-slide-x-transition>
          <div
            v-if="!attributeEditing"
            key="type-tracks"
            class="wrapper d-flex flex-column"
          >
            <TypeList
              class="flex-grow-1"
              :types="types"
              :checked-types.sync="checkedTypes"
              :color-map="typeColorMap"
            />
            <v-divider />
            <Tracks
              :tracks="tracks"
              :types="types"
              :checked-tracks.sync="checkedTracks"
              :selected-track="selectedTrackId"
              :editing-track="editingTrack"
              class="flex-shrink-0"
              @goto-track-first-frame="gotoTrackFirstFrame"
              @delete-track="deleteTrack"
              @edit-track="editTrack($event.trackId)"
              @click-track="clickTrack"
              @add-track="addTrack"
              @track-type-change="trackTypeChange"
            />
          </div>
          <div
            v-else
            key="attributes"
            class="wrapper d-flex"
          >
            <AttributesPanel
              :selected-detection="selectedDetection"
              :selected-track="selectedTrack"
              @change="attributeChange"
            />
          </div>
        </v-slide-x-transition>
      </v-card>
      <v-col style="position: relative; ">
        <component
          :is="annotatorType"
          v-if="imageUrls || videoUrl"
          ref="playbackComponent"
          v-mousetrap="[
            { bind: 'g', handler: () => toggleFeaturePointing('head') },
            { bind: 'h', handler: () => toggleFeaturePointing('head') },
            { bind: 't', handler: () => toggleFeaturePointing('tail') },
            { bind: 'y', handler: () => toggleFeaturePointing('tail') },
            { bind: 'f', handler: () => $refs.playbackComponent.nextFrame() },
            { bind: 'd', handler: () => $refs.playbackComponent.prevFrame() },
            { bind: 'q', handler: deleteDetection }
          ]"
          class="playback-component"
          :image-urls="imageUrls"
          :video-url="videoUrl"
          :frame-rate="frameRate"
          @frame-update="frame = $event"
        >
          <template slot="control">
            <Controls />
            <TimelineWrapper>
              <template #default="{maxFrame, frame, seek}">
                <Timeline
                  :max-frame="maxFrame"
                  :frame="frame"
                  :seek="seek"
                >
                  <template #child="{startFrame, endFrame, maxFrame}">
                    <LineChart
                      v-if="!showTrackView && lineChartData"
                      :start-frame="startFrame"
                      :end-frame="endFrame"
                      :max-frame="maxFrame"
                      :data="lineChartData"
                    />
                    <EventChart
                      v-if="showTrackView && eventChartData"
                      :start-frame="startFrame"
                      :end-frame="endFrame"
                      :max-frame="maxFrame"
                      :data="eventChartData"
                    />
                  </template>
                  <v-btn
                    outlined
                    x-small
                    class="toggle-timeline-button"
                    tab-index="-1"
                    @click="showTrackView = !showTrackView"
                  >
                    {{ showTrackView ? "Detection" : "Track" }}
                  </v-btn>
                </Timeline>
              </template>
            </TimelineWrapper>
          </template>
          <AnnotationLayer
            v-if="annotationData"
            :data="annotationData"
            :annotation-style="annotationStyle"
            @annotation-click="annotationClick"
            @annotation-right-click="annotationRightClick"
          />
          <EditAnnotationLayer
            v-if="editingTrack !== null"
            editing="rectangle"
            :geojson="editingDetectionGeojson"
            :feature-style="{
              fill: false,
              strokeColor: this.$vuetify.theme.themes.dark.accent
            }"
            @update:geojson="detectionChanged"
          />
          <EditAnnotationLayer
            v-if="featurePointing"
            editing="point"
            @update:geojson="featurePointed"
          />
          <TextLayer
            v-if="textData"
            :data="textData"
            :text-style="textStyle"
          />
          <MarkerLayer
            v-if="markerData"
            :data="markerData"
            :marker-style="markerStyle"
          />
        </component>
        <v-menu
          v-if="selectedDetection"
          offset-y
        >
          <template v-slot:activator="{ on }">
            <v-btn
              class="selection-menu-button"
              icon
              v-on="on"
            >
              <v-icon>mdi-dots-horizontal</v-icon>
            </v-btn>
          </template>
          <v-list>
            <v-list-item @click="toggleFeaturePointing('head')">
              <v-list-item-title>
                Add feauture points, starting with head (g key)
              </v-list-item-title>
            </v-list-item>
            <v-list-item @click="toggleFeaturePointing('tail')">
              <v-list-item-title>
                Add feature points, starting with tail (t key)
              </v-list-item-title>
            </v-list-item>
            <v-list-item @click="deleteDetection">
              <v-list-item-title>
                Delete both feauture points for current frame (q key)
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </v-col>
    </v-row>
  </v-content>
</template>

<style lang="scss" scoped>
.wrapper {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
}

.toggle-timeline-button {
  position: absolute;
  top: -24px;
  left: 2px;
}

.confidence-filter {
  flex-basis: 400px;
}

.swap-button {
  position: absolute;
  top: 5px;
  right: 5px;
  z-index: 1;
}

.selection-menu-button {
  position: absolute;
  right: 0;
  top: 0;
  z-index: 1;
}
</style>

<style lang="scss">
.playback-component .playback-container {
  background: black;
}
</style>
