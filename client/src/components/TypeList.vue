<script lang="ts">
import { PropType, Ref } from '@vue/composition-api';
import Vue from 'vue';

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
    typeColorMapper: {
      type: Function as PropType<(t: string) => string>,
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
    };
  },
  methods: {
    clickEdit(type: string) {
      this.selectedType = type;
      this.editingType = this.selectedType;
      this.showPicker = true;
      this.selectedColor = this.typeColorMapper(type);
      this.editingColor = this.selectedColor;
    },
    acceptChanges() {
      this.showPicker = false;
      if (this.editingType !== this.selectedType) {
        this.$emit('update-type-name', { currentType: this.selectedType, newType: this.editingType });
      }
      if (this.editingColor !== this.selectedColor) {
        this.$emit('update-type-color', { type: this.editingType, color: this.editingColor });
      }
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
            :color="typeColorMapper(type)"
            :label="type"
            dense
            shrink
            hide-details
            class="my-1 ml-3 typeCheckBox"
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
        class="typeEdit"
      >
        <v-card>
          <v-card-title>
            Editing Type
            <v-spacer />
            <v-spacer />
            <v-btn
              class="mr-1"
              icon
              small
              @click="showPicker = false"
            >
              <v-icon
                small
              >
                mdi-close
              </v-icon>
            </v-btn>
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
              color="primary"
              text
              @click="acceptChanges"
            >
              OK
            </v-btn>
          </v-card-actions>
        </v-card>
      </div>
    </v-dialog>
  </div>
</template>

<style lang='scss'>
.typeEdit{
  overflow: hidden;
}
.typeCheckBox{
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
