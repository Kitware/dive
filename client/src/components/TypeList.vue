<script lang="ts">
import {
  computed, defineComponent, reactive, Ref,
} from '@vue/composition-api';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import {
  useCheckedTypes, useAllTypes, useTypeStyling, useHandler,
  useUsedTypes, useFilteredTracks, useConfidenceFilters,
} from '../provides';
import TooltipBtn from './TooltipButton.vue';
import TypeEditor from './TypeEditor.vue';

export default defineComponent({
  name: 'TypeList',

  props: {
    showEmptyTypes: {
      type: Boolean,
      default: false,
    },
  },

  components: { TypeEditor, TooltipBtn },

  setup(props) {
    const { prompt } = usePrompt();

    // Ordering of these lists should match
    const sortingMethods = ['a-z', 'count'];
    const sortingMethodIcons = ['mdi-sort-alphabetical-ascending', 'mdi-sort-numeric-ascending'];

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
      settingsActive: false,
      sortingMethod: 0, // index into sortingMethods
      filterText: '',
    });
    const checkedTypesRef = useCheckedTypes();
    const allTypesRef = useAllTypes();
    const usedTypesRef = useUsedTypes();
    const typeStylingRef = useTypeStyling();
    const filteredTracksRef = useFilteredTracks();
    const confidenceFiltersRef = useConfidenceFilters();
    const {
      setCheckedTypes,
      removeTypeTracks,
    } = useHandler();

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
    }

    async function clickDelete() {
      const typeDisplay: string[] = [];
      const text = ['This will remove the type from any visible track or delete the track if it is the only type.',
        'Do you want to delete all tracks of following types:'];
      checkedTypesRef.value.forEach((item) => {
        typeDisplay.push(item);
        text.push(item.toString());
      });

      const result = await prompt({
        title: 'Confirm',
        text,
        confirm: true,
      });
      if (result) {
        removeTypeTracks([...checkedTypesRef.value]);
      }
    }

    const typeCounts = computed(() => filteredTracksRef.value.reduce((acc, filteredTrack) => {
      const confidencePair = filteredTrack.track.getType(filteredTrack.context.confidencePairIndex);
      const trackType = confidencePair[0];
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

    const headCheckState = computed(() => {
      if (checkedTypesRef.value.length === visibleTypes.value.length) {
        return 1;
      } if (checkedTypesRef.value.length === 0) {
        return 0;
      }
      return -1;
    });

    function headCheckClicked() {
      if (headCheckState.value === 0) {
        setCheckedTypes([...visibleTypes.value]);
        return;
      }
      setCheckedTypes([]);
    }


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
      /* methods */
      clickDelete,
      clickEdit,
      clickSortToggle,
      headCheckClicked,
      setCheckedTypes,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <v-container
      dense
      class="py-0"
    >
      <v-row
        class="border-highlight"
        align="center"
      >
        <v-col class="d-flex flex-row align-center py-0 mr-8">
          <v-checkbox
            :input-value="headCheckState !== -1 ? headCheckState : false"
            :indeterminate="headCheckState === -1"
            dense
            shrink
            hide-details
            color="white"
            class="my-1 type-checkbox"
            @change="headCheckClicked"
          />
          <b>Type Filter</b>
          <v-spacer />
          <tooltip-btn
            :icon="sortingMethodIcons[data.sortingMethod]"
            tooltip-text="Sort types by count or alphabetically"
            @click="clickSortToggle"
          />
          <v-btn
            icon
            small
            class="mx-2"
            @click="data.settingsActive = !data.settingsActive"
          >
            <v-icon
              small
              :color="data.settingsActive ? 'accent' : 'default'"
            >
              mdi-cog
            </v-icon>
          </v-btn>
          <v-tooltip
            open-delay="100"
            bottom
          >
            <template #activator="{ on }">
              <v-btn
                class="hover-show-child"
                :disabled="checkedTypesRef.length === 0"
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
        </v-col>
      </v-row>
      <v-row>
        <v-expand-transition>
          <slot
            v-if="data.settingsActive"
            name="settings"
          />
        </v-expand-transition>
      </v-row>
    </v-container>
    <v-text-field
      v-model="data.filterText"
      placeholder="Search labels"
      class="mx-2 mt-2 shrink"
      outlined
      dense
      clearable
      hide-details
    />
    <div class="overflow-y-auto">
      <v-container class="py-1">
        <v-row
          v-for="type in visibleTypes"
          :key="type"
          align="center"
          class="hover-show-parent"
        >
          <v-col class="d-flex flex-row py-0 align-center">
            <v-checkbox
              :input-value="checkedTypesRef"
              :value="type"
              :color="typeStylingRef.color(type)"
              dense
              shrink
              hide-details
              class="my-1 type-checkbox"
              @change="setCheckedTypes"
            >
              <template #label>
                <div class="text-body-2 grey--text text--lighten-1">
                  <span>
                    {{ `${type} (${typeCounts.get(type) || 0})` }}
                  </span>
                  <v-tooltip
                    v-if="confidenceFiltersRef[type]"
                    open-delay="100"
                    bottom
                  >
                    <template #activator="{ on }">
                      <span
                        class="outlined"
                        v-on="on"
                      >
                        <span>
                          {{ `>${confidenceFiltersRef[type]}` }}
                        </span>
                      </span>
                    </template>
                    <span>Type has threshold set individually</span>
                  </v-tooltip>
                </div>
              </template>
            </v-checkbox>
            <v-spacer />
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <v-btn
                  class="hover-show-child"
                  icon
                  small
                  v-on="on"
                  @click="clickEdit(type)"
                >
                  <v-icon
                    small
                  >
                    mdi-pencil
                  </v-icon>
                </v-btn>
              </template>
              <span>Edit</span>
            </v-tooltip>
          </v-col>
        </v-row>
      </v-container>
    </div>
    <v-dialog
      v-model="data.showPicker"
      width="350"
    >
      <TypeEditor
        :selected-type="data.selectedType"
        @close="data.showPicker = false"
      />
    </v-dialog>
  </div>
</template>

<style scoped lang='scss'>
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
