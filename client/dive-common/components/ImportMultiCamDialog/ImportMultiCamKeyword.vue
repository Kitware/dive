<!--
  Glob/keyword import UI. Requires `ctx`; uses globList, keywordFolder, filteredImages,
  open, and related handlers from props.ctx (no ctx forwarding to primitives).
-->
<script lang="ts">
import { defineComponent, PropType } from 'vue';
import { DatasetType } from 'dive-common/apispec';
import ImportMultiCamCameraGroup from './ImportMultiCamCameraGroup.vue';
import ImportMultiCamChooseSource from './ImportMultiCamChooseSource.vue';
import ImportMultiCamChooseAnnotation from './ImportMultiCamChooseAnnotation.vue';
import ImportMultiCamAddType from './ImportMultiCamAddType.vue';
import { importMultiCamContextProp } from './importMultiCamContext';

export default defineComponent({
  name: 'ImportMultiCamKeyword',
  components: {
    ImportMultiCamCameraGroup,
    ImportMultiCamChooseSource,
    ImportMultiCamChooseAnnotation,
    ImportMultiCamAddType,
  },
  props: {
    ...importMultiCamContextProp,
    dataType: {
      type: String as PropType<DatasetType>,
      required: true,
    },
    stereo: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    return {
      keywordFolder: props.ctx.keywordFolder,
      globList: props.ctx.globList,
      displayKeys: props.ctx.displayKeys,
      filteredImages: props.ctx.filteredImages,
      pendingImportPayloads: props.ctx.pendingImportPayloads,
      importAnnotationFilesCheck: props.ctx.importAnnotationFilesCheck,
      deleteSet: props.ctx.deleteSet,
      addNewSet: props.ctx.addNewSet,
      open: props.ctx.open,
      openAnnotationFile: props.ctx.openAnnotationFile,
    };
  },
});
</script>

<template>
  <div>
    <ImportMultiCamChooseSource
      camera-name="Folder or Image List"
      :data-type="dataType"
      :value="keywordFolder"
      class="mb-3"
      @open="open(dataType, 'keyword')"
      @open-text="open('text', 'keyword')"
    />
    <ImportMultiCamCameraGroup
      v-for="(item, key) in globList"
      :key="key"
      :camera-name="key"
      :show-delete="!stereo"
      class="mb-3"
      @delete="deleteSet(key)"
    >
      <v-row
        class="align-center my-3"
        no-gutters
      >
        <v-text-field
          v-model="globList[key].glob"
          label="Glob Filter Pattern"
          placeholder="Leave blank to use all images. example: *.png"
          outlined
          dense
          hide-details
        />
        <v-chip
          v-if="globList[key].glob && pendingImportPayloads.keyword"
          :color="filteredImages[key].length ? 'success' : 'error'"
          outlined
          class="ml-3"
        >
          "{{ globList[key].glob }}" matches {{ filteredImages[key].length }}
          out of {{ pendingImportPayloads.keyword.jsonMeta.originalImageFiles.length }} images
        </v-chip>
      </v-row>
      <ImportMultiCamChooseAnnotation
        v-if="item.glob && importAnnotationFilesCheck"
        :camera-name="key"
        :track-file="item.trackFile"
        class="my-3"
        @clear="item.trackFile = ''"
        @open="openAnnotationFile(key)"
      />
    </ImportMultiCamCameraGroup>
    <ImportMultiCamAddType
      v-if="!stereo"
      :name-list="displayKeys"
      class="my-3"
      @add-new="addNewSet"
    />
  </div>
</template>
