<script>
import _ from 'lodash';
import { mapState } from 'vuex';
import * as d3 from 'd3';
import colors from 'vuetify/lib/util/colors';


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
  },
};



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
