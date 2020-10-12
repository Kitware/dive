<script lang="ts">
import { defineComponent } from '@vue/composition-api';

import { getDetections } from '../api/viameDetection.service';
/**
 * ViewerLoader is responsible for loading
 * data from girder.
 */
export default defineComponent({
  props: {
    datasetId: {
      type: String,
      required: true,
    },
  },

  setup(props) {

    async function loadTracks(datasetFolderId: string) {
      const data = await getDetections(datasetFolderId, 'track_json');
      if (data !== null) {
        Object.values(data).forEach(
          (trackData) => insertTrack(Track.fromJSON(trackData)),
        );
      }
    }
  },
})
</script>
