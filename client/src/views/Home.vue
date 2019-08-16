<script>
import VideoAnnotator from "@/components/VideoAnnotator";
import Controls from "@/components/Controls";
import AnnotationLayer from "@/components/AnnotationLayer";

export default {
  name: "Home",
  components: {
    VideoAnnotator,
    Controls,
    AnnotationLayer
  },
  data: () => ({ selectedAnnotation: null }),
  computed: {
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
  // created() {
  //   console.log(this);
  // },
  methods: {
    selectAnnotation(data, e) {
      this.selectedAnnotation = data;
    }
  }
};
</script>

<template>
  <v-layout fill-height>
    <VideoAnnotator
      :videoMeta="{ url: '//localhost:8083/video.mp4', frameRate: 12 }"
    >
      <template slot="control">
        <Controls />
      </template>
      <AnnotationLayer
        :data="annotationData"
        :featureStyle="annotationFeatureStyle"
        @annotation-click="selectAnnotation"
      />
    </VideoAnnotator>
  </v-layout>
</template>
