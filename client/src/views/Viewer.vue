<script>
import { API_URL } from "@/constants";
import VideoAnnotator from "@/components/VideoAnnotator";
import ImageAnnotator from "@/components/ImageAnnotator";
import Controls from "@/components/Controls";
import AnnotationLayer from "@/components/AnnotationLayer";
import TextLayer from "@/components/TextLayer";
import TimelineWrapper from "@/components/TimelineWrapper";
import Timeline from "@/components/timeline/Timeline";
import LineChart from "@/components/timeline/LineChart";

export default {
  name: "Viewer",
  inject: ["girderRest"],
  components: {
    VideoAnnotator,
    ImageAnnotator,
    Controls,
    AnnotationLayer,
    TextLayer,
    Timeline,
    TimelineWrapper,
    LineChart
  },
  data: () => ({
    dataset: null,
    selectedDetection: null
  }),
  computed: {
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
    annotationData() {
      if (!this.detections) {
        return null;
      }
      return this.detections.map(detection => {
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
      if (!this.detections) {
        return null;
      }
      var data = [];
      this.detections.forEach(detection => {
        var bounds = detection.bounds;
        detection.confidencePairs.forEach(([type, confidence], i) => {
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
      if (!this.detections) {
        return null;
      }
      var cache = new Map();
      this.detections.forEach(detection => {
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
  async created() {
    var datasetId = this.$route.params.datasetId;
    await this.loadDataset(datasetId);
    if (!this.dataset) {
      this.$router.replace("/viewer");
    }
  },
  methods: {
    async loadDataset(datasetId) {
      var { data: dataset } = await this.girderRest.get(`item/${datasetId}`);
      if (!dataset || !dataset.meta || !dataset.meta.viame) {
        return null;
      }
      this.dataset = dataset;
    },
    selectAnnotation(data) {
      this.selectedDetection = data.detection;
    }
  }
};
</script>

<template>
  <v-layout>
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
  </v-layout>
</template>
