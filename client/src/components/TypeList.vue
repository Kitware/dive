<script lang="ts">
import { computed, defineComponent, reactive } from '@vue/composition-api';
import {
  useCheckedTypes, useAllTypes, useTypeStyling, useHandler, useUsedTypes, useFilteredTracks,
} from 'vue-media-annotator/provides';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import TypeEditor from './TypeEditor.vue';

export default defineComponent({
  name: 'TypeList',

  props: {
    showEmptyTypes: {
      type: Boolean,
      default: false,
    },
  },

  components: { TypeEditor },

  setup(props) {
    const { prompt } = usePrompt();
    const checkedTypesRef = useCheckedTypes();
    const allTypesRef = useAllTypes();
    const usedTypesRef = useUsedTypes();
    const typeStylingRef = useTypeStyling();
    const filteredTracksRef = useFilteredTracks();
    const {
      setCheckedTypes,
      removeTypeTracks,
    } = useHandler();
    const data = reactive({
      showPicker: false,
      selectedType: '',
      settingsActive: false,
    });

    const visibleTypes = computed(() => {
      if (props.showEmptyTypes) {
        return allTypesRef.value;
      }
      return usedTypesRef.value;
    });

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

    function clickEdit(type: string) {
      data.showPicker = true;
      data.selectedType = type;
    }

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

    const typeCounts = computed(() => filteredTracksRef.value.reduce((acc, filteredTrack) => {
      const confidencePair = filteredTrack.track.getType(filteredTrack.context.confidencePairIndex);
      const trackType = confidencePair[0];
      acc.set(trackType, (acc.get(trackType) || 0) + 1);

      return acc;
    }, new Map<string, number>()));


    return {
      headCheckState,
      visibleTypes,
      usedTypesRef,
      checkedTypesRef,
      typeStylingRef,
      typeCounts,
      data,
      /* methods */
      clickDelete,
      clickEdit,
      headCheckClicked,
      setCheckedTypes,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <v-subheader class="flex-shrink-0">
      Type Filter
    </v-subheader>
    <v-container
      dense
      class="py-0"
    >
      <v-row
        class="border-highlight"
        align="center"
      >
        <v-col class="d-flex flex-row align-center py-0">
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
          <b class="mt-1">Visibility</b>
          <v-spacer />
          <v-btn
            icon
            small
            class="mr-2"
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
    <div class="overflow-y-auto">
      <v-container class="py-2">
        <v-row
          v-for="type in visibleTypes"
          :key="type"
          class="hover-show-parent"
        >
          <v-col class="d-flex flex-row align-center py-0">
            <v-checkbox
              :input-value="checkedTypesRef"
              :value="type"
              :color="typeStylingRef.color(type)"
              :label="`${type} (${typeCounts.get(type) || 0})`"
              dense
              shrink
              hide-details
              class="my-1 type-checkbox"
              @change="setCheckedTypes"
            />
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
   border-top: 1px solid gray;
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
</style>
