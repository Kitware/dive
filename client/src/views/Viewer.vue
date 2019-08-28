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
    files: null,
    selectedAnnotation: null
  }),
  computed: {
    annotatorType() {
      if (!this.dataset) {
        return null;
      }
      if (this.dataset.meta.viame.type === "video") {
        return VideoAnnotator;
      } else if (this.dataset.meta.viame.type === "image-sequence") {
        return ImageAnnotator;
      }
    },
    videoUrl() {
      if (!this.files) {
        return null;
      }
      return `${API_URL}/file/${this.files[0]._id}/download`;
    },
    imageUrls() {
      if (!this.files) {
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
      return this.dataset.meta.viame.fps;
    },
    annotationData() {
      var lastX = 0;
      var lastY = 0;
      return Array.from(Array(2000).keys()).map(i => {
        var x = lastX + (Math.random() > 0.5 ? 2 : -1);
        var y = lastY + (Math.random() > 0.5 ? 2 : -1);
        lastX = x;
        lastY = y;
        return {
          frame: i,
          polygon: {
            type: "Polygon",
            coordinates: [
              [[x, y], [20 + x, y], [20 + x, 20 + y], [x, 20 + y], [x, y]]
            ]
          }
        };
      });
    },
    annotationFeatureStyle() {
      var selectedAnnotation = this.selectedAnnotation;
      return {
        strokeColor: (a, b, data) => {
          return data === selectedAnnotation ? "red" : "lime";
        }
      };
    }
  },
  async created() {
    var datasetId = this.$route.params.datasetId;
    var { dataset, files } = await this.getDataset(datasetId);
    if (!dataset) {
      this.$router.replace("/viewer");
    } else {
      this.dataset = dataset;
      this.files = files;
    }
  },
  methods: {
    async getDataset(datasetId) {
      var { data: dataset } = await this.girderRest.get(`item/${datasetId}`);
      if (!dataset || !dataset.meta || !dataset.meta.viame) {
        return null;
      }
      var { data: files } = await this.girderRest.get(
        `item/${dataset._id}/files`
      );
      if (!files.length) {
        return;
      }
      return {
        dataset,
        files
      };
    },
    selectAnnotation(data, e) {
      this.selectedAnnotation = data;
    }
  }
};
</script>

<template>
  <v-layout fill-height>
    <component
      :is="annotatorType"
      :image-urls="imageUrls"
      :video-url="videoUrl"
      :frame-rate="frameRate"
    >
      <template slot="control">
        <Controls />
      </template>
      <AnnotationLayer
        :data="annotationData"
        :featureStyle="annotationFeatureStyle"
        @annotation-click="selectAnnotation"
      />
    </component>
  </v-layout>
</template>
