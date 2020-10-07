<script lang="ts">
import { defineComponent, reactive } from '@vue/composition-api';
import { useCheckedTypes, useAllTypes, useTypeStyling } from '../provides';

export default defineComponent({
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
    });
    const checkedTypesRef = useCheckedTypes();
    const allTypesRef = useAllTypes();
    const typeStylingRef = useTypeStyling();

    function clickEdit(type: string) {
      data.selectedType = type;
      data.editingType = data.selectedType;
      data.showPicker = true;
      data.editingColor = typeStylingRef.value.color(type);
      data.editingThickness = typeStylingRef.value.strokeWidth(type);
      data.editingFill = typeStylingRef.value.fill(type);
      data.editingOpacity = typeStylingRef.value.opacity(type);
    }

    async function clickDelete(type: string) {
      const result = await prompt({
        title: 'Confirm',
        text: `Do you want to delete all tracks of type: ${type}`,
        confirm: true,
      });
      if (result) {
        emit('delete-type-tracks', { type });
      }
    }

    function acceptChanges() {
      data.showPicker = false;
      if (data.editingType !== data.selectedType) {
        emit('update-type-name', {
          currentType: data.selectedType,
          newType: data.editingType,
        });
      }
      emit('update-type-style', {
        type: data.editingType,
        color: data.editingColor,
        strokeWidth: data.editingThickness,
        fill: data.editingFill,
        opacity: data.editingOpacity,
      });
    }

    return {
      allTypesRef,
      checkedTypesRef,
      data,
      typeStylingRef,
      /* methods */
      acceptChanges,
      clickEdit,
      clickDelete,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <v-subheader class="flex-shrink-0">
      Type Filter
    </v-subheader>
    <div class="overflow-y-auto">
      <v-container class="py-2">
        <v-row
          v-for="type in allTypesRef"
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
              @change="$emit('update-checked-types', $event)"
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
                  @click="clickDelete(type)"
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
                  @click="clickDelete(type)"
                >
                  <v-icon
                    small
                    color="error"
                  >
                    mdi-delete
                  </v-icon>
                </v-btn>
              </template>
              <span>Delete</span>
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
          <v-card-actions>
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
