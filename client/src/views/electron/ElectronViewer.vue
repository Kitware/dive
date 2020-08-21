<template>
  <div id="app">
    <div class="player-container">
      <vue-core-video-player src="./your_video_source.mp4"></vue-core-video-player>
    </div>
  </div>
</template>

<script>
import VueCoreVideoPlayer from 'vue-core-video-player';

export default {
  name: 'app',
  components: {
    VueCoreVideoPlayer,
  },
};

</script>
