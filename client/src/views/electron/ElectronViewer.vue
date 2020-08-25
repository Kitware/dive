<script lang="ts">
// import VideoPlayer from '@/components/VideoPlayer.vue';

export default {
  name: 'VideoExample',
  components: {
    // VideoPlayer,
  },
  data() {
    return {
      videoOptions: {
        autoplay: true,
        controls: true,
        sources: [
          {
            src:
              '/path/to/video.mp4',
            type: 'video/mp4',
          },
        ],
      },
    };
  },
};
</script>

<template>
  <h3>Testing Electron Implementation</h3>
<!--   <div>
    <video-player
      :options="videoOptions"
      class="player"
    />
  </div> -->
</template>
