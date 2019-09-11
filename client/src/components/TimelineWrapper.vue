<script>
import Timeline from "@/components/timeline/Timeline";

export default {
  name: "TimelineWrapper",
  components: {
    Timeline
  },
  inject: ["annotator"],
  methods: {
    seek(frame) {
      this.annotator.$emit("seek", frame);
    }
  }
};
</script>

<template>
  <Timeline :maxFrame="annotator.maxFrame" :frame="annotator.frame" @seek="seek" />
</template>