<script>
import VideoAnnotator from "@/components/VideoAnnotator";
import Controls from "@/components/Controls";
import AnnotationLayer from "@/components/AnnotationLayer";

export default {
  components: {
    VideoAnnotator,
    Controls,
    AnnotationLayer
  },
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
      <AnnotationLayer :data="annotationData" />
    </VideoAnnotator>
  </v-layout>
</template>
