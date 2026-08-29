<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, reactive, ref, Ref,
  watch,
} from 'vue';
import {
  debounce, difference, union,
} from 'lodash';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { clientSettings } from 'dive-common/store/settings';
import { compileHierarchy } from 'dive-common/typeHierarchy';
import {
  useCameraStore, useHandler, useReadOnlyMode, useSelectedCamera, useTime,
  usePendingSaveCount,
} from '../provides';
import TooltipBtn from './TooltipButton.vue';
import TypeEditor from './TypeEditor.vue';
import TypeItem from './TypeItem.vue';
import BaseFilterControls, { AnnotationWithContext } from '../BaseFilterControls';
import TrackFilterControls from '../TrackFilterControls';
import Track from '../track';
import Group from '../Group';
import StyleManager from '../StyleManager';
import {
  createRegionSuppressionTester, getSuppressedTrackIds, hasSuppressionAttribute,
  suppressionTypeResolver,
} from '../use/suppression';
import {
  buildTypeListModel, countResolvedTypes, TypeListModel, TypeListRow,
  updateHierarchyCheckedTypes,
} from '../typeListHierarchy';

/* Row height shared by the type rows, the shared-lineage breadcrumb, and the
   scroller's height accounting. Mirrored by `$row-height` in the style block. */
const ROW_HEIGHT = 30;
const EMPTY_HIERARCHY_INDEX = compileHierarchy({});

interface VirtualTypeItem extends TypeListRow {
  confidenceFilterNum: number;
  displayText: string;
  color: string;
  tree: boolean;
  isSuppressionType: boolean;
  suppressionThreshold: number;
}

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
    /* Sidebar (~80) vs bottom bar (~50) header chrome */
    headerHeight: {
      type: Number,
      default: 80,
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
    // Bumped on every annotation edit (add/move/delete); read in the frame
    // counts so they re-evaluate suppression when a region is moved, since a
    // track's geometry is not itself a reactive dependency.
    const pendingSaveCount = usePendingSaveCount();
    const trackStore = computed(() => (
      cameraStore.camMap.value.get(selectedCamera.value)?.trackStore
    ));
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
    const suppressionResolutionRef = computed(() => (
      trackFilters instanceof TrackFilterControls ? suppressionTypeResolver(trackFilters) : undefined
    ));
    const checkedTypesRef = trackFilters.checkedTypes;
    const allTypesRef = trackFilters.allTypes;
    const usedTypesRef = trackFilters.usedTypes;
    const typeStylingRef = props.styleManager.typeStyling;
    const filteredTracksRef = trackFilters.filteredAnnotations;
    const confidenceFiltersRef = trackFilters.confidenceFilters;
    const collapsedTypes: Ref<Set<string>> = ref(new Set<string>());
    const compactSharedLineage = ref(true);
    const hierarchyIndexRef = computed(() => (
      !props.group && trackFilters instanceof TrackFilterControls
        ? trackFilters.hierarchyIndex.value
        : undefined
    ));
    const hierarchyActive = computed(() => hierarchyIndexRef.value !== undefined);
    if (trackFilters instanceof TrackFilterControls) {
      watch(trackFilters.typeHierarchy, () => {
        collapsedTypes.value = new Set<string>();
        compactSharedLineage.value = true;
      });
    }

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

    /**
     * Ids of tracks whose every keyframe detection is suppressed - covered by
     * a region on each frame it appears, or flagged with the suppression
     * attribute - across all cameras. These are excluded from the
     * dataset-wide type totals. This walks every keyframe of every track, so
     * it is recomputed on a debounce rather than on every save-counter bump:
     * dragging a region's corner fires an edit per mouse move, and
     * recomputing the whole dataset per move froze the resize.
     */
    const fullySuppressedIds: Ref<Set<number>> = ref(new Set<number>());
    function computeFullySuppressedIds() {
      const editRevision = pendingSaveCount.value;
      const suppType = clientSettings.typeSettings.suppressionType;
      const suppThreshold = clientSettings.typeSettings.suppressionThreshold;
      const suppressionResolver = suppressionResolutionRef.value;
      const excluded = new Set<number>();
      if (!suppType || editRevision < 0) {
        fullySuppressedIds.value = excluded;
        return;
      }
      cameraStore.camMap.value.forEach(({ trackStore: store }) => {
        // Inclusive [begin, end] spans of suppression-region tracks. Regions
        // interpolate between keyframes, so a keyframe-only set would miss
        // detections whose keyframes fall on interpolated-only region frames.
        const regionRanges: [number, number][] = [];
        store.annotationMap.forEach((annotation) => {
          const track = annotation as Track;
          if ((suppressionResolver
            ? suppressionResolver.displayType(track)
            : track.confidencePairs?.[0]?.[0]) === suppType) {
            regionRanges.push([track.begin, track.end]);
          }
        });
        const hasRegionAt = (f: number) => regionRanges.some(([b, e]) => f >= b && f <= e);
        const suppressedAt = (f: number) => getSuppressedTrackIds(
          store,
          f,
          suppType,
          suppThreshold,
          { revision: editRevision, resolver: suppressionResolver },
        );
        store.annotationMap.forEach((annotation) => {
          const track = annotation as Track;
          if (typeof track.getFeature !== 'function') {
            return;
          }
          const keyframes = track.features.filter((f) => f && f.keyframe);
          if (keyframes.length > 0
            && keyframes.every((f) => (hasRegionAt(f.frame)
                && suppressedAt(f.frame).has(track.id))
              || hasSuppressionAttribute(track, f.frame, suppType))) {
            excluded.add(track.id);
          }
        });
      });
      fullySuppressedIds.value = excluded;
    }
    const debouncedFullySuppressed = debounce(computeFullySuppressedIds, 500);
    watch(pendingSaveCount, () => debouncedFullySuppressed());
    watch(
      [
        () => clientSettings.typeSettings.suppressionType,
        () => clientSettings.typeSettings.suppressionThreshold,
        cameraStore.camMap,
        suppressionResolutionRef,
      ],
      () => computeFullySuppressedIds(),
      { immediate: true },
    );
    onBeforeUnmount(() => debouncedFullySuppressed.cancel());

    /**
     * Tally displayed types. With a hierarchy installed each track also counts
     * toward its ancestors, and a track spanning several cameras counts once.
     */
    function countTypes(tracks: readonly AnnotationWithContext<Track | Group>[]) {
      const entries = tracks.map(({ annotation, context }) => ({
        id: annotation.id,
        type: annotation.getType(context.confidencePairIndex),
      }));
      const hierarchyIndex = hierarchyIndexRef.value;
      if (hierarchyIndex) {
        return countResolvedTypes(entries, hierarchyIndex);
      }
      return entries.reduce(
        (acc, { type }) => acc.set(type, (acc.get(type) || 0) + 1),
        new Map<string, number>(),
      );
    }

    const typeCounts = computed(() => {
      const excluded = fullySuppressedIds.value;
      return countTypes(filteredTracksRef.value
        .filter(({ annotation }) => !excluded.has(annotation.id)));
    });

    function countedTracksForFrame(targetFrame: number) {
      // Depend on the edit counter so moving/resizing a suppression region
      // (which mutates geometry, not the reactive track set) re-runs the count.
      // It is always >= 0, so this reads the dependency without changing logic.
      const editRevision = pendingSaveCount.value;
      const activeTrackStore = trackStore.value;
      if (!activeTrackStore) {
        return [];
      }
      const trackIdsForFrame = activeTrackStore.intervalTree
        .search([targetFrame, targetFrame])
        .map((str) => parseInt(str, 10));
      // Detections suppressed by a region on this frame are dropped so the
      // per-frame type counts read off the interface exclude them, and
      // attribute-suppressed detections (visible, real type retained) don't
      // count toward their own type either.
      const suppType = clientSettings.typeSettings.suppressionType;
      const suppressedIds = editRevision >= 0
        ? getSuppressedTrackIds(
          activeTrackStore,
          targetFrame,
          suppType,
          clientSettings.typeSettings.suppressionThreshold,
          { revision: editRevision, resolver: suppressionResolutionRef.value },
        )
        : new Set<number>();
      const filteredKeyFrameTracks = filteredTracksRef.value.filter((track) => {
        if (suppressedIds.has(track.annotation.id)) {
          return false;
        }
        const realTrack = activeTrackStore.getPossible(track.annotation.id);
        if (realTrack && hasSuppressionAttribute(realTrack, targetFrame, suppType)) {
          return false;
        }
        const keyframe = realTrack?.getFeature(targetFrame)[0];
        return !!keyframe?.keyframe;
      });
      return filteredKeyFrameTracks.filter(
        (track) => trackIdsForFrame.includes(track.annotation.id),
      );
    }

    const filteredTracksForFrame = computed(() => countedTracksForFrame(frame.value));

    const currentFrameTrackTypes = computed(() => countTypes(filteredTracksForFrame.value));

    const filterTypesByFrame = ref(clientSettings.typeSettings.filterTypesByFrame);

    watch(() => clientSettings.typeSettings.filterTypesByFrame, (newValue) => {
      filterTypesByFrame.value = newValue;
    });
    const noFrameCounts = new Map<string, number>();
    const typeListModel: Ref<TypeListModel> = computed(() => {
      const sort = sortingMethods[data.sortingMethod];
      const byFrame = filterTypesByFrame.value ?? false;
      // The model needs frame counts only when they affect row visibility or order.
      // Otherwise playback can update displayed counts without rebuilding the tree.
      const usesFrameCounts = byFrame || sort === 'frame count';
      return buildTypeListModel({
        hierarchyIndex: hierarchyIndexRef.value || EMPTY_HIERARCHY_INDEX,
        allTypes: allTypesRef.value,
        usedTypes: usedTypesRef.value,
        configuredTypes: trackFilters.configuredTypes.value,
        checkedTypes: checkedTypesRef.value,
        counts: typeCounts.value,
        frameCounts: usesFrameCounts ? currentFrameTrackTypes.value : noFrameCounts,
        showEmpty: props.showEmptyTypes,
        query: data.filterText,
        filterTypesByFrame: byFrame,
        sort,
        collapsed: collapsedTypes.value,
        compactSharedLineage: compactSharedLineage.value,
      });
    });
    const sharedLineage = computed(() => typeListModel.value.sharedLineage);
    const sharedLineageText = computed(() => sharedLineage.value.join(' › '));
    const visibleTypes = computed(() => typeListModel.value.actionableTypes);
    /* The delete button carries out what the header selected, so it reads the
       same displayed rows rather than every type that happens to be checked. */
    const deletableTypes = computed(() => {
      const checked = new Set(checkedTypesRef.value);
      return visibleTypes.value.filter((type) => checked.has(type));
    });
    async function clickDelete() {
      const text: string[] = props.group
        ? ['This will remove the group assignment from any visible tracks and delete the group. Do you want to delete all groups of the following types:']
        : ['This will remove the type from any visible track or delete the track if it is the only type. Do you want to delete all tracks of following types:'];
      text.push('-------');
      deletableTypes.value.forEach((item) => text.push(item.toString()));

      const result = await prompt({
        title: 'Really delete types?',
        text,
        confirm: true,
      });
      if (result) {
        trackFilters.removeTypeAnnotations([...deletableTypes.value]);
      }
    }

    const virtualTypes: Ref<readonly VirtualTypeItem[]> = computed(() => {
      const confidenceFiltersDeRef = confidenceFiltersRef.value;
      const typeCountsDeRef = typeCounts.value;
      const typeStylingDeRef = typeStylingRef.value;
      const frameTrackTypesDeRef = currentFrameTrackTypes.value;
      const { suppressionType, suppressionThreshold } = clientSettings.typeSettings;
      const { rows } = typeListModel.value;
      return rows.map(({ type, ...row }) => ({
        ...row,
        type,
        confidenceFilterNum: confidenceFiltersDeRef[type] || 0,
        displayText: `${typeCountsDeRef.get(type) || 0} : ${frameTrackTypesDeRef.get(type) || 0}\u00A0 ${type}`,
        color: typeStylingDeRef.color(type),
        tree: hierarchyActive.value,
        isSuppressionType: !!suppressionType && type === suppressionType,
        suppressionThreshold: suppressionThreshold ?? 99,
      }));
    });
    /* An empty list is ambiguous on its own: the dataset may define nothing, or
       the filters may have excluded everything it does define. */
    const emptyListText = computed(() => {
      if (virtualTypes.value.length > 0) return '';
      const noun = props.group ? 'groups' : 'types';
      const anyDefined = allTypesRef.value.length > 0 || usedTypesRef.value.length > 0;
      return anyDefined ? `No ${noun} match the current filters` : `No ${noun} yet`;
    });
    const headCheckState = computed(() => {
      const uncheckedTypes = difference(visibleTypes.value, checkedTypesRef.value);
      /* An empty list lands here too: nothing to act on reads as unchecked. */
      if (uncheckedTypes.length === visibleTypes.value.length) {
        return 0;
      }
      return uncheckedTypes.length === 0 ? 1 : -1;
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

    function updateCheckedType(type: string) {
      const model = typeListModel.value;
      const shouldCheck = model.checkState.get(type) !== 'checked';
      trackFilters.updateCheckedTypes(updateHierarchyCheckedTypes(
        checkedTypesRef.value,
        model.subtree,
        type,
        shouldCheck,
      ));
    }

    function toggleExpanded(type: string) {
      if (data.filterText.length > 0) {
        return;
      }
      const next = new Set(collapsedTypes.value);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      collapsedTypes.value = next;
    }

    function toggleSharedLineage() {
      compactSharedLineage.value = !compactSharedLineage.value;
    }

    const showSharedLineageControl = computed(() => (
      sharedLineage.value.length > 0 && data.filterText.length === 0
    ));
    const virtualHeight = computed(() => (
      props.height - props.headerHeight - (showSharedLineageControl.value ? ROW_HEIGHT : 0)
    ));

    const goToPeakTrackFrame = (trackType: string) => {
      const subtreeSet = new Set(
        hierarchyActive.value ? typeListModel.value.subtree.get(trackType) : [trackType],
      );
      const tracksFilteredByType = filteredTracksRef.value.filter(({ annotation, context }) => (
        subtreeSet.has(annotation.getType(context.confidencePairIndex))
      ));
      const activeTrackStore = trackStore.value;
      if (!activeTrackStore) {
        handler.seekFrame(-1);
        return;
      }
      /* The displayed frame counts are selected-camera scoped, so the peak is too. */
      const suppType = clientSettings.typeSettings.suppressionType;
      const isRegionSuppressed = createRegionSuppressionTester(
        activeTrackStore,
        suppType,
        clientSettings.typeSettings.suppressionThreshold,
        suppressionResolutionRef.value,
      );
      const countByFrame = new Map<number, number>();
      tracksFilteredByType.forEach(({ annotation }) => {
        const realTrack = activeTrackStore.getPossible(annotation.id);
        realTrack?.features
          .filter((item) => item?.keyframe)
          .forEach((item) => {
            if (hasSuppressionAttribute(realTrack, item.frame, suppType)
              || isRegionSuppressed(realTrack, item.frame)) {
              return;
            }
            countByFrame.set(item.frame, (countByFrame.get(item.frame) || 0) + 1);
          });
      });

      let maxFrame = -1;
      let maxCount = 0;
      countByFrame.forEach((count, candidateFrame) => {
        if (count > maxCount) {
          maxCount = count;
          maxFrame = candidateFrame;
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
      hierarchyActive,
      compactSharedLineage,
      sharedLineage,
      sharedLineageText,
      showSharedLineageControl,
      headCheckState,
      visibleTypes,
      deletableTypes,
      emptyListText,
      usedTypesRef,
      checkedTypesRef,
      confidenceFiltersRef,
      typeStylingRef,
      typeCounts,
      sortingMethods,
      sortingMethodIcons,
      virtualHeight,
      virtualTypes,
      rowHeight: ROW_HEIGHT,
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
      toggleExpanded,
      toggleSharedLineage,
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
          class="d-flex flex-row align-center py-0 pr-2"
        >
          <v-checkbox
            :input-value="headCheckState !== -1 ? headCheckState : false"
            :indeterminate="headCheckState === -1"
            :disabled="disableAnnotationFilters || visibleTypes.length === 0"
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
          <div class="type-header-actions d-flex align-center ml-auto">
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
                  :disabled="deletableTypes.length === 0 || readOnlyMode"
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
            <slot name="header-trailing" />
          </div>
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
    <div
      v-if="showSharedLineageControl"
      class="shared-lineage d-flex align-center mx-2"
    >
      <span
        v-if="compactSharedLineage"
        class="shared-lineage-text text-body-2 grey--text text--lighten-1"
        :title="sharedLineageText"
      >
        {{ sharedLineageText }}
      </span>
      <v-btn
        text
        small
        class="shared-lineage-action ml-auto flex-shrink-0"
        :aria-label="compactSharedLineage ? 'Expand parents' : 'Compact parents'"
        @click="toggleSharedLineage"
      >
        {{ compactSharedLineage ? 'Expand Parents' : 'Compact Parents' }}
      </v-btn>
    </div>
    <div class="py-2 overflow-y-hidden">
      <div
        v-if="emptyListText"
        class="empty-list text-body-2 grey--text text--lighten-1 mx-2"
      >
        {{ emptyListText }}
      </div>
      <v-virtual-scroll
        v-else
        class="tracks"
        :items="virtualTypes"
        :item-height="rowHeight"
        :height="virtualHeight"
        :role="hierarchyActive ? 'list' : undefined"
        :aria-label="hierarchyActive ? 'Track type hierarchy' : undefined"
        bench="1"
      >
        <template #default="{ item }">
          <type-item
            :type="item.type"
            :checked="item.checked"
            :indeterminate="item.indeterminate"
            :tree="item.tree"
            :depth="item.depth"
            :has-children="item.hasChildren"
            :expanded="item.expanded"
            :disclosure-visible="data.filterText.length === 0"
            :color="item.color"
            :display-text="item.displayText"
            :confidence-filter-num="item.confidenceFilterNum"
            :width="width"
            :display-max-button="showMaxFrameButton"
            :disabled="disableAnnotationFilters"
            :is-suppression-type="item.isSuppressionType"
            :suppression-threshold="item.suppressionThreshold"
            @setCheckedTypes="updateCheckedType(item.type)"
            @toggleExpanded="toggleExpanded(item.type)"
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

$row-height: 30px;

.border-highlight {
   border-bottom: 1px solid gray;
 }

.type-checkbox {
  max-width: 80%;
  overflow-wrap: anywhere;
}

.type-header-actions {
  flex-shrink: 0;
}

.shared-lineage {
  height: $row-height;
  min-width: 0;
}

.shared-lineage-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
