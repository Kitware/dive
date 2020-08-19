<script>
import { mapMutations } from 'vuex';
import { getLocationType } from '@girder/components/src/utils';
import NavigationBar from '@/components/NavigationBar.vue';
import { getPathFromLocation, getLocationFromRoute } from '@/utils';
import { deleteResources } from '@/lib/api/viame.service';

export default {
  name: 'Home',
  components: {
    NavigationBar,
  },
  inject: ['notificationBus'],
  data: () => ({
    uploaderDialog: false,
    selected: [],
    uploading: false,
    loading: false,
  }),
  computed: {
    location: {
      get() {
        return this.$store.state.Location.location;
      },
      /**
       * This setter is used by Girder Web Components to set the location when it changes
       * by clicking on a Breadcrumb link
       */
      set(value) {
        if (this.locationIsViameFolder && value.name === 'auxiliary') {
          return;
        }
        const newPath = getPathFromLocation(value);
        if (this.$route.path !== newPath) {
          this.$router.push(newPath);
        }
        this.setLocation(value);
      },
    },
  },
  watch: {
    uploading(newval) {
      if (!newval) {
        this.$refs.fileManager.$refs.girderBrowser.refresh();
        this.uploaderDialog = false;
      }
    },
  },
  async created() {
    this.setLocation(await getLocationFromRoute(this.$route));
    this.notificationBus.$on('message:job_status', this.handleNotification);
  },
  beforeDestroy() {
    this.notificationBus.$off('message:job_status', this.handleNotification);
  },
  methods: {
    ...mapMutations('Location', ['setLocation']),
    handleNotification() {
      this.$refs.fileManager.$refs.girderBrowser.refresh();
    },
    dragover() {
      if (this.shouldShowUpload) {
        this.uploaderDialog = true;
      }
    },
  },
};
</script>

<template>
  <v-content>
    <NavigationBar />
  </v-content>
</template>

<style lang='scss'>
.nowraptable table thead tr th .row {
  flex-wrap: nowrap;
}
</style>
