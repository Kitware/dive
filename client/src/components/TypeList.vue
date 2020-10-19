<script lang="ts">
import { computed, defineComponent, reactive } from '@vue/composition-api';
import {
  useCheckedTypes, useAllTypes, useTypeStyling, useHandler, useUsedTypes,
} from '../provides';


export default defineComponent({
  props: {
    viewUnused: {
      type: Boolean,
      default: false,
    },
  },
  name: 'TypeList',

  setup(props, { emit, root }) {
    const prompt = root.$prompt;

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
    });
    const checkedTypesRef = useCheckedTypes();
    const allTypesRef = useAllTypes();
    const usedTypesRef = useUsedTypes();
    const typeStylingRef = useTypeStyling();
    const {
      updateTypeName,
      updateTypeStyle,
      setCheckedTypes,
      removeTypeTracks,
      deleteType,
    } = useHandler();

    const visibleTypes = computed(() => {
      if (props.viewUnused) {
        return allTypesRef.value;
      }
      return usedTypesRef.value;
    });
    function clickEdit(type: string) {
      data.selectedType = type;
      data.editingType = data.selectedType;
      data.showPicker = true;
      data.editingColor = typeStylingRef.value.color(type);
      data.editingThickness = typeStylingRef.value.strokeWidth(type);
      data.editingFill = typeStylingRef.value.fill(type);
      data.editingOpacity = typeStylingRef.value.opacity(type);
    }

    async function clickDelete() {
      const typeDisplay: string[] = [];
      const text = ['Do you want to delete all tracks of following types:'];
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

    async function clickDeleteType(type: string) {
      const text = `Do you want to delete this empty Type: ${type}`;

      const result = await prompt({
        title: 'Confirm',
        text,
        confirm: true,
      });
      if (result) {
        deleteType(type);
        data.showPicker = false;
      }
    }

    function acceptChanges() {
      data.showPicker = false;
      if (data.editingType !== data.selectedType) {
        updateTypeName({
          currentType: data.selectedType,
          newType: data.editingType,
        });
      }
      updateTypeStyle({
        type: data.editingType,
        color: data.editingColor,
        strokeWidth: data.editingThickness,
        fill: data.editingFill,
        opacity: data.editingOpacity,
      });
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


    return {
      visibleTypes,
      usedTypesRef,
      checkedTypesRef,
      data,
      typeStylingRef,
      /* methods */
      acceptChanges,
      clickEdit,
      clickDeleteType,
      clickDelete,
      headCheckState,
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
      <v-row class="border-highlight">
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
          <b>Visibility</b>
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
              mdi-settings
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
              :label="type"
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
      <div
        class="type-edit"
      >
        <v-card>
          <v-card-title>
            Editing Type
          </v-card-title>
          <v-card-subtitle class="my-0 py-0">
            <v-container class="py-0">
              <v-row>
                {{ data.selectedType }}
                <v-spacer />
                <v-btn
                  icon
                  small
                  @click="showPicker = false"
                >
                  <v-icon
                    small
                  >
                    mdi-exit
                  </v-icon>
                </v-btn>
              </v-row>
            </v-container>
          </v-card-subtitle>
          <v-card-text>
            <v-form v-model="data.valid">
              <v-row>
                <v-col>
                  <v-text-field
                    v-model="data.editingType"
                    label="Type Name"
                    hide-details
                  />
                </v-col>
              </v-row>
              <v-row class="align-center">
                <v-col>
                  <v-text-field
                    v-model="data.editingThickness"
                    type="number"
                    :rules="[
                      val => val >= 0 || 'Must be >= 0'
                    ]"
                    required
                    hide-details
                    label="Box Border Thickness"
                  />
                </v-col>
                <v-col>
                  <v-checkbox
                    v-model="data.editingFill"
                    label="Fill"
                    dense
                    shrink
                    hint="Toggle Box Shading"
                    persistent-hint
                  />
                </v-col>
              </v-row>
              <v-row>
                <v-col>
                  <v-slider
                    v-model="data.editingOpacity"
                    :label="`${data.editingOpacity.toFixed(2)}`"
                    min="0.0"
                    max="1.0"
                    step="0.01"
                    height="8"
                    hint="Border & Fill Opacity"
                    class="pr-3"
                    persistent-hint
                  />
                </v-col>
              </v-row>
              <v-row
                dense
                align="center"
              >
                <v-col class="mx-2">
                  <v-color-picker
                    v-model="data.editingColor"
                    hide-inputs
                  />
                </v-col>
              </v-row>
            </v-form>
          </v-card-text>
          <v-card-actions class="">
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <div v-on="on">
                  <v-btn
                    class="hover-show-child"
                    :disabled="usedTypesRef.includes(data.selectedType)"
                    small
                    color="error"
                    @click="clickDeleteType()"
                  >
                    Delete Type
                  </v-btn>
                </div>
              </template>
              <v-alert
                v-if="usedTypesRef.includes(data.selectedType)"
                class="ma-0 pa-1"
                color="error"
              >
                Only empty types can be deleted!!
              </v-alert>
            </v-tooltip>
            <v-spacer />
            <v-btn
              depressed=""
              text
              @click="data.showPicker = false"
            >
              Cancel
            </v-btn>
            <v-btn
              color="primary"
              depressed
              :disabled="!data.valid"
              @click="acceptChanges"
            >
              Save
            </v-btn>
          </v-card-actions>
        </v-card>
      </div>
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
