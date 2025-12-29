<script lang="ts">
import {
  computed, defineComponent, PropType, reactive, ref, Ref,
  watch,
} from 'vue';
import { difference, union } from 'lodash';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { clientSettings } from 'dive-common/store/settings';
import {
  useCameraStore, useHandler, useReadOnlyMode, useSelectedCamera, useTime,
} from '../provides';
import TooltipBtn from './TooltipButton.vue';
import TypeEditor from './TypeEditor.vue';
import TypeItem from './TypeItem.vue';
import BaseFilterControls from '../BaseFilterControls';
import Track from '../track';
import Group from '../Group';
import StyleManager from '../StyleManager';

interface VirtualTypeItem {
  type: string;
  confidenceFilterNum: number;
  displayText: string;
  color: string;
  checked: boolean;
}

/* Magic numbers involved in height calculation */
const TypeListHeaderHeight = 80;

export default defineComponent({
  name: 'FilterList',

  components: { TypeEditor, TooltipBtn, TypeItem },

  props: {
    showEmptyTypes: {
      type: Boolean,
      default: false,
    },
    height: {
      type: Number,
      default: 200,
    },
    width: {
      type: Number,
      default: 300,
    },
    filterControls: {
      type: Object as PropType<BaseFilterControls<Track | Group>>,
      required: true,
    },
    styleManager: {
      type: Object as PropType<StyleManager>,
      required: true,
    },
    group: {
      type: Boolean,
      default: false,
    },
  },

  setup(props) {
    const { prompt } = usePrompt();
    const handler = useHandler();
    const readOnlyMode = useReadOnlyMode();
    const cameraStore = useCameraStore();
    const selectedCamera = useSelectedCamera();
    const { frame } = useTime();
    const trackStore = cameraStore.camMap.value.get(selectedCamera.value)?.trackStore;
    // Ordering of these lists should match
    const sortingMethods: ('a-z' | 'count' | 'frame count')[] = ['a-z', 'count', 'frame count'];
    const sortingMethodIcons = ['mdi-sort-alphabetical-ascending', 'mdi-sort-numeric-ascending', 'mdi-sort-clock-ascending-outline'];

    const data = reactive({
      showPicker: false,
      selectedColor: '',
      selectedType: '',
      editingType: '',
      editingColor: '',
      editingThickness: 5,
      editingFill: false,
      editingOpacity: 1.0,
      valid: true,
      sortingMethod: sortingMethods.findIndex((item) => item === clientSettings.typeSettings.trackSortDir), // index into sortingMethods
      filterText: '',
    });
    const trackFilters = props.filterControls;
    const checkedTypesRef = trackFilters.checkedTypes;
    const allTypesRef = trackFilters.allTypes;
    const usedTypesRef = trackFilters.usedTypes;
    const typeStylingRef = props.styleManager.typeStyling;
    const filteredTracksRef = trackFilters.filteredAnnotations;
    const confidenceFiltersRef = trackFilters.confidenceFilters;

    function clickEdit(type: string) {
      data.selectedType = type;
      data.editingType = data.selectedType;
      data.showPicker = true;
      data.editingColor = typeStylingRef.value.color(type);
      data.editingThickness = typeStylingRef.value.strokeWidth(type);
      data.editingFill = typeStylingRef.value.fill(type);
      data.editingOpacity = typeStylingRef.value.opacity(type);
    }

    function clickSortToggle() {
      data.sortingMethod = (data.sortingMethod + 1) % sortingMethods.length;
      clientSettings.typeSettings.trackSortDir = sortingMethods[data.sortingMethod];
    }

    async function clickDelete() {
      const typeDisplay: string[] = [];
      let text: string[] = [];
      if (props.group) {
        text = [
          'This will remove the group assignment from any visible tracks and delete the group. Do you want to delete all groups of the following types:',
        ];
      } else {
        text = [
          'This will remove the type from any visible track or delete the track if it is the only type. Do you want to delete all tracks of following types:',
        ];
      }
      text.push('-------');
      checkedTypesRef.value.forEach((item) => {
        typeDisplay.push(item);
        text.push(item.toString());
      });

      const result = await prompt({
        title: 'Really delete types?',
        text,
        confirm: true,
      });
      if (result) {
        trackFilters.removeTypeAnnotations([...checkedTypesRef.value]);
      }
    }

    const typeCounts = computed(() => filteredTracksRef.value.reduce((acc, filteredTrack) => {
      const confidencePair = filteredTrack.annotation
        .getType(filteredTrack.context.confidencePairIndex);
      const trackType = confidencePair;
      acc.set(trackType, (acc.get(trackType) || 0) + 1);

      return acc;
    }, new Map<string, number>()));

    const filteredTracksForFrame = computed(() => {
      const trackIdsForFrame = trackStore?.intervalTree
        .search([frame.value, frame.value])
        .map((str) => parseInt(str, 10));
      const filteredKeyFrameTracks = filteredTracksRef.value.filter((track) => {
        const keyframe = trackStore?.getPossible(track.annotation.id)?.getFeature(frame.value)[0];
        return !!keyframe?.keyframe;
      });
      return (filteredKeyFrameTracks.filter((track) => trackIdsForFrame?.includes(track.annotation.id)));
    });

    const currentFrameTrackTypes = computed(() => filteredTracksForFrame.value.reduce((acc, filteredTrack) => {
      const confidencePair = filteredTrack.annotation
        .getType(filteredTrack.context.confidencePairIndex);
      const trackType = confidencePair;
      acc.set(trackType, (acc.get(trackType) || 0) + 1);

      return acc;
    }, new Map<string, number>()));

    function sortAndFilterTypes(types: Ref<readonly string[]>) {
      const filtered = types.value
        .filter((t) => t.toLowerCase().includes(data.filterText.toLowerCase()));
      switch (sortingMethods[data.sortingMethod]) {
        case 'a-z':
          return filtered.sort();
        case 'count':
          return filtered.sort(
            (a, b) => (typeCounts.value.get(b) || 0) - (typeCounts.value.get(a) || 0),
          );
        case 'frame count':
          return filtered.sort(
            (a, b) => (currentFrameTrackTypes.value.get(b) || 0) - (currentFrameTrackTypes.value.get(a) || 0),
          );
        default:
          return filtered;
      }
    }

    const visibleTypes = computed(() => {
      if (props.showEmptyTypes) {
        return sortAndFilterTypes(allTypesRef);
      }
      return sortAndFilterTypes(usedTypesRef);
    });
    const filterTypesByFrame = ref(clientSettings.typeSettings.filterTypesByFrame);

    watch(() => clientSettings.typeSettings.filterTypesByFrame, (newValue) => {
      filterTypesByFrame.value = newValue;
    });
    const virtualTypes: Ref<readonly VirtualTypeItem[]> = computed(() => {
      const confidenceFiltersDeRef = confidenceFiltersRef.value;
      const typeCountsDeRef = typeCounts.value;
      const typeStylingDeRef = typeStylingRef.value;
      const checkedTypesDeRef = checkedTypesRef.value;
      const frameTrackTypesDeRef = currentFrameTrackTypes.value;
      let filteredTypeList = visibleTypes.value;
      if (filterTypesByFrame.value) {
        filteredTypeList = filteredTypeList.filter((item) => frameTrackTypesDeRef.get(item));
      }
      return filteredTypeList.map((item) => ({
        type: item,
        confidenceFilterNum: confidenceFiltersDeRef[item] || 0,
        displayText: `${typeCountsDeRef.get(item) || 0}:${frameTrackTypesDeRef.get(item) || 0} ${item}`,
        color: typeStylingDeRef.color(item),
        checked: checkedTypesDeRef.includes(item),
      }));
    });
    const headCheckState = computed(() => {
      const uncheckedTypes = difference(visibleTypes.value, checkedTypesRef.value);
      if (uncheckedTypes.length === 0) {
        return 1;
      } if (uncheckedTypes.length === visibleTypes.value.length) {
        return 0;
      }
      return -1;
    });

    function headCheckClicked() {
      if (headCheckState.value === 0) {
        /* Enable only what is filtered AND don't change what isn't filtered */
        const allVisibleAndCheckedInvisible = union(
          /* What was already checked and is currently not visible */
          difference(checkedTypesRef.value, visibleTypes.value),
          /* What is visible */
          visibleTypes.value,
        );
        trackFilters.updateCheckedTypes(allVisibleAndCheckedInvisible);
      } else {
        /* Disable whatever is both checked and filtered */
        const invisible = difference(checkedTypesRef.value, visibleTypes.value);
        trackFilters.updateCheckedTypes(invisible);
      }
    }

    function updateCheckedType(evt: boolean, type: string) {
      if (evt) {
        trackFilters.updateCheckedTypes(checkedTypesRef.value.concat([type]));
      } else {
        trackFilters.updateCheckedTypes(difference(checkedTypesRef.value, [type]));
      }
    }

    const virtualHeight = computed(() => props.height - TypeListHeaderHeight);

    const goToPeakTrackFrame = (trackType: string) => {
      const frameCounts = new Map<number, number>();

      const tracksFilteredByType = filteredTracksRef.value.filter((track) => track.annotation.getType(track.context.confidencePairIndex) === trackType);
      tracksFilteredByType.forEach((track) => {
        const trackObj = cameraStore.getAnyPossibleTrack(track.annotation.id);
        if (trackObj) {
          trackObj.features.filter((item) => item.keyframe).forEach((item) => {
            const current = frameCounts.get(item.frame) || 0;
            frameCounts.set(item.frame, current + 1);
          });
        }
      });

      let maxFrame = -1;
      let maxCount = 0;
      frameCounts.forEach((count, f) => {
        if (count > maxCount) {
          maxCount = count;
          maxFrame = f;
        }
      });
      handler.seekFrame(maxFrame);
    };

    const showMaxFrameButton = computed(() => clientSettings.typeSettings.maxCountButton);

    const disableAnnotationFilters = computed({
      get: () => props.filterControls.disableAnnotationFilters.value,
      set: (val: boolean) => {
        // eslint-disable-next-line no-param-reassign
        props.filterControls.disableAnnotationFilters.value = val;
      },
    });

    return {
      data,
      headCheckState,
      visibleTypes,
      usedTypesRef,
      checkedTypesRef,
      confidenceFiltersRef,
      typeStylingRef,
      typeCounts,
      sortingMethods,
      sortingMethodIcons,
      virtualHeight,
      virtualTypes,
      readOnlyMode,
      filteredTracksRef,
      disableAnnotationFilters,
      /* methods */
      clickDelete,
      clickEdit,
      clickSortToggle,
      headCheckClicked,
      setCheckedTypes: trackFilters.updateCheckedTypes,
      updateCheckedType,
      goToPeakTrackFrame,
      showMaxFrameButton,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <v-container
      dense
    >
      <v-row
        class="border-highlight align-center"
      >
        <v-col
          id="type-header"
          class="d-flex flex-row align-center py-0 mr-8"
        >
          <v-checkbox
            :input-value="headCheckState !== -1 ? headCheckState : false"
            :indeterminate="headCheckState === -1"
            :disabled="disableAnnotationFilters"
            dense
            shrink
            hide-details
            color="white"
            class="my-1 type-checkbox mt-0"
            @change="headCheckClicked"
          />
          <v-tooltip
            open-delay="100"
            bottom
          >
            <template #activator="{ on }">
              <v-icon
                small
                class="mr-1 hover-show-child"
                :color="disableAnnotationFilters ? 'primary' : ''"
                v-on="on"
                @click="disableAnnotationFilters = !disableAnnotationFilters"
              >
                mdi-filter-off-outline
              </v-icon>
            </template>
            <span>Disable Filters and Show All Annotations</span>
          </v-tooltip>
          <v-tooltip
            open-delay="100"
            bottom
          >
            <template #activator="{ on }">
              <b v-on="on">Type Filter</b>
            </template>
            <span>Toggle Type TotalCount:FrameCount Type Name</span>
          </v-tooltip>
          <v-spacer />
          <tooltip-btn
            :icon="sortingMethodIcons[data.sortingMethod]"
            :tooltip-text="`Sort types by Total Count, Alphabetically or Frame Count, current: ${sortingMethods[data.sortingMethod]}`"
            @click="clickSortToggle"
          />
          <slot name="settings" />
          <v-tooltip
            open-delay="100"
            bottom
          >
            <template #activator="{ on }">
              <v-btn
                class="hover-show-child"
                :disabled="checkedTypesRef.length === 0 || readOnlyMode"
                icon
                small
                v-on="on"
                @click="clickDelete()"
              >
                <v-icon
                  small
                  color="error"
                >
                  mdi-delete
                </v-icon>
              </v-btn>
            </template>
            <span>Delete visible items</span>
          </v-tooltip>
          <v-spacer />
        </v-col>
      </v-row>
    </v-container>
    <input
      id="search-types"
      v-model="data.filterText"
      type="text"
      placeholder="Search types"
      class="mx-2 mt-2 shrink input-box"
    >
    <div class="py-2 overflow-y-hidden">
      <v-virtual-scroll
        class="tracks"
        :items="virtualTypes"
        :item-height="30"
        :height="virtualHeight"
        bench="1"
      >
        <template #default="{ item }">
          <type-item
            :type="item.type"
            :checked="item.checked"
            :color="item.color"
            :display-text="item.displayText"
            :confidence-filter-num="item.confidenceFilterNum"
            :width="width"
            :display-max-button="showMaxFrameButton"
            :disabled="disableAnnotationFilters"
            @setCheckedTypes="updateCheckedType($event, item.type)"
            @goToMaxFrame="goToPeakTrackFrame($event)"
            @clickEdit="clickEdit"
          />
        </template>
      </v-virtual-scroll>
    </div>
    <v-dialog
      v-model="data.showPicker"
      width="350"
    >
      <TypeEditor
        :selected-type="data.selectedType"
        :filter-controls="filterControls"
        :style-manager="styleManager"
        :group="group"
        @close="data.showPicker = false"
      />
    </v-dialog>
  </div>
</template>

<style scoped lang='scss'>
@import 'src/components/styles/common.scss';

.border-highlight {
   border-bottom: 1px solid gray;
 }

.type-checkbox {
  max-width: 80%;
  overflow-wrap: anywhere;
}

.hover-show-parent {
  .hover-show-child {
    display: none;
  }

  &:hover {
    .hover-show-child {
      display: inherit;
    }
  }
}
.outlined {
  background-color: gray;
  color: #222;
  font-weight: 600;
  border-radius: 6px;
  padding: 0 5px;
  font-size: 12px;
}
</style>
