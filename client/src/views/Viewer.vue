<script>
import _ from "lodash";
import { mapState } from "vuex";

import { API_URL } from "@/constants";
import NavigationTitle from "@/components/NavigationTitle";
import VideoAnnotator from "@/components/VideoAnnotator";
import ImageAnnotator from "@/components/ImageAnnotator";
import Controls from "@/components/Controls";
import AnnotationLayer from "@/components/AnnotationLayer";
import EditAnnotationLayer from "@/components/EditAnnotationLayer";
import ConfidenceFilter from "@/components/ConfidenceFilter";
import Tracks from "@/components/Tracks";
import TypeList from "@/components/TypeList";
import TextLayer from "@/components/TextLayer";
import MarkerLayer from "@/components/MarkerLayer";
import TimelineWrapper from "@/components/TimelineWrapper";
import Timeline from "@/components/timeline/Timeline";
import LineChart from "@/components/timeline/LineChart";
import EventChart from "@/components/timeline/EventChart";
import { getPathFromLocation } from "@/utils";

export default {
  name: "Viewer",
  inject: ["girderRest"],
  components: {
    NavigationTitle,
    VideoAnnotator,
    ImageAnnotator,
    Controls,
    AnnotationLayer,
    EditAnnotationLayer,
    TextLayer,
    MarkerLayer,
    Timeline,
    TimelineWrapper,
    ConfidenceFilter,
    Tracks,
    TypeList,
    LineChart,
    EventChart
  },
  data: () => ({
    dataset: null,
    detections: null,
    selectedTrack: null,
    checkedTracks: [],
    checkedTypes: [],
    confidence: 0.1,
    showTrackView: false,
    editingTrack: null,
    metaEditingTrack: null,
    frame: null
  }),
  computed: {
    ...mapState(["location"]),
    annotatorType() {
      if (!this.dataset) {
        return null;
      }
      if (this.dataset.meta.type === "video") {
        return VideoAnnotator;
      } else if (this.dataset.meta.type === "image-sequence") {
        return ImageAnnotator;
      }
      return null;
    },
    imageUrls() {
      if (!this.files || this.dataset.meta.type !== "image-sequence") {
        return null;
      }
      return this.files.map(file => {
        return `${API_URL}/file/${file._id}/download`;
      });
    },
    frameRate() {
      if (!this.dataset) {
        return null;
      }
      return this.dataset.meta.fps;
    },
    filteredDetections() {
      if (!this.detections) {
        return null;
      }
      var checkedTracksSet = new Set(this.checkedTracks);
      var checkedTypesSet = new Set(this.checkedTypes);
      var confidence = this.confidence;
      return this.detections.filter(
        detection =>
          checkedTracksSet.has(detection.track) &&
          (detection.confidencePairs.length === 0 ||
            detection.confidencePairs.find(
              pair => pair[1] > confidence && checkedTypesSet.has(pair[0])
            ))
      );
    },
    annotationData() {
      if (!this.filteredDetections) {
        return null;
      }
      return this.filteredDetections.map(detection => {
        return {
          detection,
          frame: detection.frame,
          polygon: boundToGeojson(detection.bounds)
        };
      });
    },
    annotationStyle() {
      var selectedTrack = this.selectedTrack;
      var editingTrack = this.editingTrack;
      return {
        strokeColor: (a, b, data) => {
          return data.record.detection.track === selectedTrack ? "red" : "lime";
        },
        strokeOpacity: (a, b, data) => {
          return data.record.detection.track === editingTrack ? 0.5 : 1;
        }
      };
    },
    textData() {
      if (!this.filteredDetections) {
        return null;
      }
      var data = [];
      this.filteredDetections.forEach(detection => {
        var bounds = detection.bounds;
        if (!detection.confidencePairs) {
          return;
        }
        detection.confidencePairs
          .filter(pair => pair[1] >= this.confidence)
          .forEach(([type, confidence], i) => {
            data.push({
              detection,
              frame: detection.frame,
              text: `${type}: ${confidence.toFixed(2)}`,
              x: bounds[1],
              y: bounds[2],
              offsetY: i * 14
            });
          });
      });
      return data;
    },
    textStyle() {
      var selectedTrack = this.selectedTrack;
      return {
        color: data => {
          return data.detection.track === selectedTrack ? "red" : "lime";
        },
        offsetY(data) {
          return data.offsetY;
        }
      };
    },
    markerData() {
      if (!this.filteredDetections) {
        return null;
      }
      var data = [];
      this.filteredDetections.forEach(detection => {
        Object.entries(detection.features).forEach(([key, value]) => {
          data.push({
            detection,
            frame: detection.frame,
            feature: key,
            x: value[0],
            y: value[1]
          });
        });
      });
      return data;
    },
    markerStyle() {
      var selectedTrack = this.selectedTrack;
      return {
        fillColor: data => {
          if (data.detection.track === selectedTrack) {
            return red;
          }
          return data.feature === "head" ? "orange" : "blue";
        },
        radius: 4,

        stroke: false
      };
    },
    lineChartData() {
      if (!this.filteredDetections) {
        return null;
      }
      var cache = new Map();
      this.filteredDetections.forEach(detection => {
        var frame = detection.frame;
        cache.set(frame, cache.get(frame) + 1 || 1);
      });
      return [
        {
          values: Array.from(cache.entries()).sort((a, b) => a[0] - b[0]),
          color: "green",
          name: "Total"
        }
      ];
    },
    eventChartData() {
      if (!this.filteredDetections) {
        return [];
      }
      return Object.entries(
        _.groupBy(this.filteredDetections, detection => detection.track)
      ).map(([name, detections]) => {
        var range = [
          _.minBy(detections, detection => detection.frame).frame,
          _.maxBy(detections, detection => detection.frame).frame
        ];
        return {
          track: detections[0].track,
          name: `Track ${name}`,
          color: ["green", "red", "orange", "blue", "purple"][
            Math.floor((Math.random() * 10) / 2)
          ],
          range
        };
      });
    },
    tracks() {
      if (!this.detections) {
        return [];
      }
      var tracks = _.uniqBy(this.detections, detection => detection.track).map(
        ({ track, confidencePairs }) => ({ track, confidencePairs })
      );
      return _.sortBy(tracks, track => track.track);
    },
    types() {
      if (!this.tracks) {
        return [];
      }
      var typeSet = new Set();
      for (var { confidencePairs } of this.tracks) {
        for (var pair of confidencePairs) {
          typeSet.add(pair[0]);
        }
      }
      return Array.from(typeSet);
    },
    editingDetection() {
      if (this.editingTrack == null || this.frame == null) {
        return null;
      }
      return this.detections.find(
        detection =>
          detection.track === this.editingTrack &&
          detection.frame === this.frame
      );
    },
    editingDetectionGeojson() {
      if (!this.editingDetection) {
        return null;
      }
      return boundToGeojson(this.editingDetection.bounds);
    }
  },
  asyncComputed: {
    async files() {
      if (!this.dataset) {
        return null;
      }
      var { data: files } = await this.girderRest.get(
        `item/${this.dataset._id}/files`,
        { params: { limit: 100000 } }
      );
      return files;
    },
    async videoUrl() {
      if (!this.dataset || this.dataset.meta.type !== "video") {
        return null;
      }
      var { data: clipMeta } = await this.girderRest.get(
        "viame_detection/clip_meta",
        {
          params: {
            itemId: this.dataset._id
          }
        }
      );
      if (!clipMeta.video) {
        return null;
      }
      var { data: files } = await this.girderRest.get(
        `item/${clipMeta.video._id}/files`
      );
      if (!files[0]) {
        return null;
      }
      return `${API_URL}/file/${files[0]._id}/download`;
    }
  },
  watch: {
    detections() {
      this.updatecheckedTracksAndTypes();
    }
  },
  async created() {
    var datasetId = this.$route.params.datasetId;
    try {
      await this.loadDataset(datasetId);
      await this.loadDetections();
    } catch (ex) {
      this.$router.replace("/");
    }
  },
  methods: {
    getPathFromLocation,
    async loadDataset(datasetId) {
      var { data: dataset } = await this.girderRest.get(`item/${datasetId}`);
      if (!dataset || !dataset.meta || !dataset.meta.viame) {
        return null;
      }
      this.dataset = dataset;
    },
    async loadDetections() {
      var { data: detections } = await this.girderRest.get("viame_detection", {
        params: { itemId: this.dataset._id }
      });
      this.detections = detections.map(detection => {
        return Object.freeze(detection);
      });
    },
    annotationClick(data) {
      this.selectTrack(data.detection.track);
    },
    clickTrack(track) {
      this.selectTrack(track.track);
    },
    selectTrack(track) {
      if (this.editingTrack) {
        this.editingTrack = null;
        return;
      }
      this.selectedTrack = this.selectedTrack === track ? null : track;
    },
    updatecheckedTracksAndTypes() {
      if (!this.tracks) {
        return;
      }
      this.checkedTracks = this.tracks.map(track => track.track);
      this.checkedTypes = this.types;
    },
    gotoTrackFirstFrame(track) {
      this.selectedTrack = track.track;
      var frame = this.eventChartData.find(d => d.track === track.track)
        .range[0];
      this.$refs.playpackComponent.provided.$emit("seek", frame);
    },
    async deleteTrack(track) {
      var result = await this.$prompt({
        title: "Confirm",
        text: `Please confirm to delete track ${track.track}`,
        confirm: true
      });
      if (!result) {
        return;
      }
      this.detections
        .filter(detection => detection.track === track.track)
        .forEach(detection => {
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
      this.editingTrack = this.tracks.slice(-1)[0].track + 1;
    },
    detectionChanged(feature) {
      if (!this.editingTrack) {
        return;
      }
      var bounds =
        feature.type === "Feature"
          ? geojsonToBound2(feature.geometry)
          : geojsonToBound(feature);
      var confidencePairs = [];
      var trackMeta = this.tracks.find(
        track => track.track === this.editingTrack
      );
      if (trackMeta) {
        confidencePairs = trackMeta.confidencePairs;
      }
      // make a reference before change
      if (this.editingDetection) {
        this.detections.splice(
          this.detections.indexOf(this.editingDetection),
          1
        );
      }
      this.detections.push(
        Object.freeze({
          track: this.editingTrack,
          confidencePairs,
          frame: this.frame,
          bounds
        })
      );
    }
  }
};

function boundToGeojson(bounds) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [bounds[0], bounds[2]],
        [bounds[1], bounds[2]],
        [bounds[1], bounds[3]],
        [bounds[0], bounds[3]],
        [bounds[0], bounds[2]]
      ]
    ]
  };
}

function geojsonToBound(geojson) {
  var coords = geojson.coordinates[0];
  return [coords[0][0], coords[1][0], coords[0][1], coords[2][1]];
}

function geojsonToBound2(geojson) {
  var coords = geojson.coordinates[0];
  return [coords[0][0], coords[2][0], coords[1][1], coords[0][1]];
}
</script>

<template>
  <v-content class="viewer">
    <v-app-bar app>
      <NavigationTitle />
      <v-tabs icons-and-text hide-slider>
        <v-tab :to="getPathFromLocation(location)"
          >Data<v-icon>mdi-database</v-icon></v-tab
        >
      </v-tabs>
      <ConfidenceFilter :confidence.sync="confidence" />
    </v-app-bar>
    <v-row no-gutters class="fill-height">
      <v-card width="300" style="z-index:1;">
        <div class="wrapper d-flex flex-column" v-if="!metaEditingTrack">
          <TypeList
            class="flex-grow-1"
            :types="types"
            :checkedTypes.sync="checkedTypes"
          />
          <v-divider />
          <Tracks
            :tracks="tracks"
            :checked-tracks.sync="checkedTracks"
            :selected-track="selectedTrack"
            :editing-track="editingTrack"
            class="flex-shrink-0"
            @goto-track-first-frame="gotoTrackFirstFrame"
            @delete-track="deleteTrack"
            @edit-track="editTrack($event.track)"
            @edit-track-meta="metaEditingTrack=$event.track"
            @click-track="clickTrack"
            @add-track="addTrack"
          />
        </div>
      </v-card>
      <v-col style="position: relative; ">
        <component
          class="playback-component"
          ref="playpackComponent"
          v-if="imageUrls || videoUrl"
          :is="annotatorType"
          :image-urls="imageUrls"
          :video-url="videoUrl"
          :frame-rate="frameRate"
          @frame-update="frame = $event"
        >
          <template slot="control">
            <Controls />
            <TimelineWrapper>
              <template #default="{maxFrame, frame, seek}">
                <Timeline :maxFrame="maxFrame" :frame="frame" :seek="seek">
                  <template #child="{startFrame, endFrame, maxFrame}">
                    <LineChart
                      v-if="!showTrackView && lineChartData"
                      :startFrame="startFrame"
                      :endFrame="endFrame"
                      :maxFrame="maxFrame"
                      :data="lineChartData"
                    />
                    <EventChart
                      v-if="showTrackView && eventChartData"
                      :startFrame="startFrame"
                      :endFrame="endFrame"
                      :maxFrame="maxFrame"
                      :data="eventChartData"
                    />
                  </template>
                  <v-btn
                    outlined
                    x-small
                    class="toggle-timeline-button"
                    @click="showTrackView = !showTrackView"
                    tabIndex="-1"
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
            :annotationStyle="annotationStyle"
            @annotation-click="annotationClick"
            @annotation-right-click="annotationRightClick"
          />
          <EditAnnotationLayer
            v-if="editingTrack !== null"
            :geojson="editingDetectionGeojson"
            :feature-style="{ fill: false, strokeColor: 'lime' }"
            @update:geojson="detectionChanged"
          />
          <TextLayer v-if="textData" :data="textData" :textStyle="textStyle" />
          <MarkerLayer v-if="markerData" :data="markerData" :markerStyle="markerStyle" />
        </component>
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
  flex-basis: 600px;
}
</style>

<style lang="scss">
.playback-component .playback-container {
  background: black;
}
</style>
