<script lang="ts">
import { PropType, Ref } from '@vue/composition-api';
import Vue from 'vue';
import { TypeStyling } from '../use/useStyling';

export default Vue.extend({
  name: 'TypeList',

  props: {
    checkedTypes: {
      type: Object as PropType<Ref<string[]>>,
      required: true,
    },
    allTypes: {
      type: Object as PropType<Ref<string[]>>,
      required: true,
    },
    typeStyling: {
      type: Object as PropType<Ref<TypeStyling>>,
      required: true,
    },
  },
  data() {
    return {
      showPicker: false,
      selectedColor: '',
      selectedType: '',
      editingType: '',
      editingColor: '',
      editingThickness: 5,
      editingFill: false,
      editingOpacity: 1.0,
    };
  },
  methods: {
    clickEdit(type: string) {
      this.selectedType = type;
      this.editingType = this.selectedType;
      this.showPicker = true;
      this.editingColor = this.typeStyling.value.color(type);
      this.editingThickness = this.typeStyling.value.strokeWidth(type);
      this.editingFill = this.typeStyling.value.fill(type);
      this.editingOpacity = this.typeStyling.value.opacity(type);
    },
    acceptChanges() {
      this.showPicker = false;
      if (this.editingType !== this.selectedType) {
        this.$emit('update-type-name', { currentType: this.selectedType, newType: this.editingType });
      }
      this.$emit('update-type-style', {
        type: this.editingType,
        color: this.editingColor,
        strokeWidth: this.editingThickness,
        fill: this.editingFill,
        opacity: this.editingOpacity,
      });
      this.colorRefresh();
    },
    /**
     * Causes the color to refresh for annotations and events by toggling an item
     */
    colorRefresh() {
      const val = this.checkedTypes.value.pop();
      if (val) {
        this.checkedTypes.value.push(val); // Causes a color refresh
      }
    },
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <v-subheader class="flex-shrink-0">
      Type Filter
    </v-subheader>
    <div class="overflow-y-auto flex-grow-1">
      <v-container>
        <v-row
          v-for="type in allTypes.value"
          :key="type"
          class="hover-show-parent"
        >
          <v-checkbox
            v-model="checkedTypes.value"
            :value="type"
            :color="typeStyling.value.color(type)"
            :label="type"
            dense
            shrink
            hide-details
            class="my-1 ml-3 type-checkbox"
          />
          <v-spacer />
          <v-tooltip
            open-delay="100"
            bottom
          >
            <template #activator="{ on }">
              <v-btn
                class="mr-1 hover-show-child"
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
        </v-row>
      </v-container>
    </div>
    <v-dialog
      v-model="showPicker"
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
                {{ selectedType }}
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
          <v-container class="pt-0">
            <v-row dense>
              <v-col>
                <v-text-field
                  v-model="editingType"
                  label="Name"
                />
              </v-col>
            </v-row>
            <v-row>
              <v-col>
                <v-text-field
                  v-model="editingThickness"
                  type="number"
                  :rules="[
                    val => (val || '').length > 0 || 'This field is required'
                  ]"
                  required
                  label="Line Thickness"
                  hide-details
                />
              </v-col>
              <v-col>
                <v-checkbox
                  v-model="editingFill"
                  label="Fill"
                  dense
                  shrink
                  hide-details
                  class="my-1 ml-3 type-checkbox"
                />
              </v-col>
            </v-row>
            <v-row>
              <v-col>
                <v-slider
                  v-model="editingOpacity"
                  min="0.0"
                  max="1.0"
                  step="0.01"
                  class="align-center"
                  height="10"
                  dense
                  label="Opacity"
                  hide-details
                >
                  <template v-slot:append>
                    <v-text-field
                      v-model="editingOpacity"
                      class="mt-0 pt-0"
                      hide-details
                      single-line
                      type="number"
                      style="width: 60px"
                    />
                  </template>
                </v-slider>
              </v-col>
            </v-row>
            <v-row
              dense
              align="center"
            >
              <v-col class="mx-2">
                <v-color-picker
                  v-model="editingColor"
                  hide-inputs
                />
              </v-col>
            </v-row>
          </v-container>
          <v-card-actions>
            <v-spacer />
            <v-btn
              depressed=""
              text
              @click="showPicker = false"
            >
              Cancel
            </v-btn>
            <v-btn
              color="primary"
              depressed
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
.type-edit{
  overflow: hidden;
}

.type-checkbox{
  max-width: 80%;
  overflow:hidden;
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
