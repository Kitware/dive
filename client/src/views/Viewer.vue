<script>
import VideoAnnotator from "@/components/VideoAnnotator";
import ImageAnnotator from "@/components/ImageAnnotator";
import Controls from "@/components/Controls";
import AnnotationLayer from "@/components/AnnotationLayer";
import { API_URL } from "@/constants";

export default {
  name: "Viewer",
  inject: ["girderRest"],
  components: {
    VideoAnnotator,
    ImageAnnotator,
    Controls,
    AnnotationLayer
  },
  data: () => ({
    dataset: null,
    selectedAnnotation: null
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
    annotationFeatureStyle() {
      var selectedAnnotation = this.selectedAnnotation;
      return {
        strokeColor: (a, b, data) => {
          return data.record === selectedAnnotation ? "red" : "lime";
        }
      };
    }
  },
  asyncComputed: {
    async files() {
      if (!this.dataset) {
        return null;
      }
      var { data: files } = await this.girderRest.get(
        `item/${this.dataset._id}/files`
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
      this.selectedAnnotation = data;
    }
  }
};
</script>

<template>
  <v-layout fill-height>
    <component
      v-if="imageUrls || videoUrl"
      :is="annotatorType"
      :image-urls="imageUrls"
      :video-url="videoUrl"
      :frame-rate="frameRate"
    >
      <template slot="control">
        <Controls />
      </template>
      <AnnotationLayer
        v-if="annotationData"
        :data="annotationData"
        :featureStyle="annotationFeatureStyle"
        @annotation-click="selectAnnotation"
      />
    </component>
  </v-layout>
</template>
