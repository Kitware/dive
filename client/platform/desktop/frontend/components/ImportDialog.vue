<script lang="ts">
import { cloneDeep } from 'lodash';
import {
  defineComponent, watch, toRef, ref, PropType,
} from '@vue/composition-api';
import { MediaImportPayload } from 'platform/desktop/constants';

import { locateDuplicates } from 'platform/desktop/frontend/store/dataset';
import { settings } from 'platform/desktop/frontend/store/settings';

export default defineComponent({
  name: 'ImportDialog',
  props: {
    importData: {
      type: Object as PropType<MediaImportPayload>,
      required: true,
    },
  },
  setup(props) {
    const argCopy = ref(cloneDeep(props.importData));
    const duplicates = ref(locateDuplicates(props.importData.jsonMeta));

    watch(toRef(props, 'importData'), (val) => {
      duplicates.value = locateDuplicates(val.jsonMeta);
      argCopy.value = cloneDeep(val);
    });

    return {
      argCopy,
      duplicates,
      settings,
    };
  },
});
</script>

<template>
  <v-card
    outlined
    class="import-card"
  >
    <v-card-title>
      Importing new {{ argCopy.jsonMeta.type }}
    </v-card-title>
    <v-card-text>
      <v-alert
        v-if="duplicates.length"
        type="warning"
        outlined
        class="mb-4"
      >
        <b>Found {{ duplicates.length }} possible duplicates</b>
        <p
          v-for="(duplicate, i) in duplicates"
          :key="duplicate.id"
          class="my-0 duplicate-list"
        >
          {{ i + 1 }}: {{ duplicate.name }} @ <pre>{{ duplicate.id }}</pre>
        </p>
        <br><b>Abort</b>
        to return to the recents list.
        <br><b>Continue</b>
        to ignore warning.
      </v-alert>
      <v-alert
        v-if="argCopy.mediaConvertList.length"
        type="info"
        outlined
        class="mb-v"
      >
        Found {{ argCopy.mediaConvertList.length }}
        item(s) in this dataset that require transcoding.  Dataset will not be
        available until transcoding is complete.
      </v-alert>
      <v-text-field
        v-model="argCopy.jsonMeta.name"
        label="Name"
        placeholder="Name for this dataset"
        hide-details
        outlined
      />
      <table class="mt-5">
        <tr>
          <td>New ID</td>
          <td>
            <pre>{{ argCopy.jsonMeta.id }}</pre>
          </td>
        </tr>
        <tr>
          <td>Data Path</td>
          <td>
            <pre>{{ settings.dataPath }}</pre>
          </td>
        </tr>
        <tr>
          <td>Source</td>
          <td>
            <pre>{{ argCopy.jsonMeta.originalBasePath }}</pre>
          </td>
        </tr>
        <tr>
          <td>FPS</td>
          <td>{{ argCopy.jsonMeta.fps }}</td>
        </tr>
        <tr v-if="argCopy.jsonMeta.type == 'image-sequence'">
          <td>Image Count</td>
          <td>{{ argCopy.jsonMeta.originalImageFiles.length }}</td>
        </tr>
      </table>
      <v-spacer />
      <div class="d-flex flex-row my-4">
        <v-btn
          text
          class="grow mr-3"
          outlined
          @click="$emit('abort')"
        >
          Abort
        </v-btn>
        <v-btn
          color="primary"
          class="grow ml-3"
          @click="$emit('finalize-import', argCopy)"
        >
          Proceed
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<style lang="scss">
.import-card {
  overflow-x: hidden;
}
.duplicate-list {
  font-size: 12px;
  pre {
    display: inline-block;
  }
}
td, th {
  text-align: left;
}
td {
  padding-right: 20px;
}
</style>
