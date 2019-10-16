<script>
import _ from "lodash";
import { mapState } from "vuex";

import { API_URL } from "@/constants";
import NavigationTitle from "@/components/NavigationTitle";
import VideoAnnotator from "@/components/VideoAnnotator";
import ImageAnnotator from "@/components/ImageAnnotator";
import Controls from "@/components/Controls";
import AnnotationLayer from "@/components/AnnotationLayer";
import ConfidenceFilter from "@/components/ConfidenceFilter";
import Tracks from "@/components/Tracks";
import TypeList from "@/components/TypeList";
import TextLayer from "@/components/TextLayer";
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
    TextLayer,
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
    selectedDetection: null,
    selectedTracks: [],
    selectedTypes: [],
    confidence: 0.1,
    showTrackView: false
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
      var selectedTracksSet = new Set(this.selectedTracks);
      var selectedtypesSet = new Set(this.selectedTypes);
      var confidence = this.confidence;
      return this.detections.filter(
        detection =>
          selectedTracksSet.has(detection.track) &&
          detection.confidencePairs.find(
            pair => pair[1] > confidence && selectedtypesSet.has(pair[0])
          )
      );
    },
    annotationData() {
      if (!this.filteredDetections) {
        return null;
      }
      return this.filteredDetections.map(detection => {
        var bounds = detection.bounds;
        return {
          detection,
          frame: detection.frame,
          polygon: {
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
          }
        };
      });
    },
    annotationStyle() {
      var selectedDetection = this.selectedDetection;
      return {
        strokeColor: (a, b, data) => {
          return data.record.detection === selectedDetection ? "red" : "lime";
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
      var selectedDetection = this.selectedDetection;
      return {
        color: data => {
          return data.detection === selectedDetection ? "red" : "lime";
        },
        offsetY(data) {
          return data.offsetY;
        }
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
      return tracks;
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
    async detections() {
      if (!this.dataset) {
        return null;
      }
      var { data: detections } = await this.girderRest.get("viame_detection", {
        params: { itemId: this.dataset._id }
      });
      return Object.freeze(detections);
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
      this.updateSelectedTracksAndTypes();
    }
  },
  async created() {
    var datasetId = this.$route.params.datasetId;
    await this.loadDataset(datasetId);
    if (!this.dataset) {
      this.$router.replace("/viewer");
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
    selectAnnotation(data) {
      this.selectedDetection = data.detection;
    },
    updateSelectedTracksAndTypes() {
      if (!this.tracks) {
        return;
      }
      this.selectedTracks = this.tracks.map(track => track.track);
      this.selectedTypes = this.types;
    }
  }
};
</script>

<template>
  <v-content>
    <v-app-bar app dense height="40">
      <NavigationTitle />
      <v-btn text :to="getPathFromLocation(location)">Data</v-btn>
    </v-app-bar>
    <v-row no-gutters class="fill-height">
      <v-card width="300" style="z-index:1;">
        <div class="wrapper d-flex flex-column">
          <ConfidenceFilter :confidence.sync="confidence" />
          <Tracks :tracks="tracks" :selectedTracks.sync="selectedTracks" />
          <TypeList
            class="flex-grow-1"
            :types="types"
            :selectedTypes.sync="selectedTypes"
          />
        </div>
      </v-card>
      <v-col style="position: relative; ">
        <component
          v-if="imageUrls || videoUrl"
          :is="annotatorType"
          :image-urls="imageUrls"
          :video-url="videoUrl"
          :frame-rate="frameRate"
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
            @annotation-click="selectAnnotation"
          />
          <TextLayer v-if="textData" :data="textData" :textStyle="textStyle" />
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
</style>
