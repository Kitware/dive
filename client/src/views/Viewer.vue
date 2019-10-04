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
import TextLayer from "@/components/TextLayer";
import TimelineWrapper from "@/components/TimelineWrapper";
import Timeline from "@/components/timeline/Timeline";
import LineChart from "@/components/timeline/LineChart";
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
    LineChart
  },
  data: () => ({
    dataset: null,
    selectedDetection: null,
    selectedTracks: [],
    confidence: 0.1
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
      return this.detections.filter(
        detection =>
          this.selectedTracks.indexOf(detection.track) !== -1 &&
          detection.confidencePairs.find(pair => pair[1] > this.confidence)
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
    tracks() {
      if (!this.detections) {
        return [];
      }
      var tracks = _.uniqBy(this.detections, detection => detection.track).map(
        ({ track, confidencePairs }) => ({ track, confidencePairs })
      );
      return tracks;
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
      this.updateSelectedTracks();
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
    updateSelectedTracks() {
      if (!this.detections) {
        return;
      }
      this.selectedTracks = _.uniq(
        this.detections.map(detection => detection.track)
      );
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
      <v-card width="300" class="sidebar">
        <div class="wrapper d-flex flex-column">
          <ConfidenceFilter :confidence.sync="confidence" />
          <Tracks :tracks="tracks" :selectedTracks.sync="selectedTracks" />
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
                      v-if="lineChartData"
                      :startFrame="startFrame"
                      :endFrame="endFrame"
                      :maxFrame="maxFrame"
                      :data="lineChartData"
                    />
                  </template>
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
</style>
