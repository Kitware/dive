<!-- eslint-disable max-len -->
<script lang="ts">
import {
  defineComponent, ref, PropType, watch, computed, reactive,
} from '@vue/composition-api';
import { useTrackFilters, useTrackStyleManager } from 'vue-media-annotator/provides';
import { Attribute, AttributeRendering } from 'vue-media-annotator/use/AttributeTypes';

export default defineComponent({
  name: 'AttributeRendering',
  props: {
    value: {
      type: Object as PropType<AttributeRendering>,
      required: true,
    },
    attribute: {
      type: Object as PropType<Attribute>,
      required: true,
    },

  },
  setup(props, { emit }) {
    const typeStylingRef = useTrackStyleManager().typeStyling;
    const trackFilterControls = useTrackFilters();
    const types = computed(() => ['all', ...trackFilterControls.allTypes.value]);

    const mainSettings = reactive({
      selected: props.value.selected || false,
      typeFilter: props.value.typeFilter || ['all'],
      order: props.value.order,
    });

    const deleteChip = (item: string) => {
      mainSettings.typeFilter.splice(mainSettings.typeFilter.findIndex((data) => data === item));
    };

    const layoutSettings = reactive({
      layout: props.value.layout,
      corner: props.value.corner,
      location: props.value.location,
    });

    const displayNameSettings = reactive({
      displayName: props.value.displayName,
      displayTextSize: props.value.displayTextSize,
      displayColor: props.value.displayColor,
      displayColorAuto: props.value.displayColor === 'auto',
    });

    const valueSettings = reactive({
      valueTextSize: props.value.valueTextSize,
      valueColor: props.value.valueColor,
      valueColorAuto: props.value.valueColor === 'auto',
    });

    const verticalDimensions = reactive({
      displayWidthType: props.value.displayWidth.type,
      displayWidthVal: props.value.displayWidth.val,
      displayHeightType: props.value.displayHeight.type,
      displayHeightVal: props.value.displayHeight.val,
    });

    const boxSettings = reactive({
      box: props.value.box,
      boxColor: props.value.boxColor,
      boxColorAuto: props.value.boxColor === 'auto',
      boxThickness: props.value.boxThickness,
      boxBackground: props.value.boxBackground,
      boxBackgroundSwitch: !!props.value.boxBackground,
      boxOpacity: props.value.boxOpacity,
    });

    const dropdownOptions = reactive({
      locationOptions: ['inside', 'outside'],
      layoutOptions: ['vertical', 'horizontal'],
      cornerOptions: ['SE', 'SW', 'NW'],
      displayDimOptions: ['px', '%', 'auto'],
    });

    const currentEditColor = ref('');
    const currentEditColorType = ref('');
    const editingColor = ref(false);

    const computedDisplayColor = computed(() => {
      if (displayNameSettings.displayColorAuto || displayNameSettings.displayColor === 'auto') {
        return props.attribute.color || 'white';
      }
      return displayNameSettings.displayColor;
    });
    const computedValueColor = computed(() => {
      if (valueSettings.valueColorAuto || valueSettings.valueColor === 'auto') {
        return props.attribute.color || 'white';
      }
      return valueSettings.valueColor;
    });
    const computedBoxColor = computed(() => {
      if (boxSettings.boxColorAuto || boxSettings.boxColor === 'auto') {
        return props.attribute.color || 'white';
      }
      return boxSettings.boxColor;
    });

    const updateSettings = () => {
      emit('input', {
        selected: mainSettings.selected,
        typeFilter: mainSettings.typeFilter,
        order: mainSettings.order,
        displayName: displayNameSettings.displayName,
        displayTextSize: displayNameSettings.displayTextSize,
        displayColor: displayNameSettings.displayColorAuto ? 'auto' : displayNameSettings.displayColor,
        valueTextSize: valueSettings.valueTextSize,
        valueColor: valueSettings.valueColorAuto ? 'auto' : valueSettings.valueColor,
        location: layoutSettings.location,
        layout: layoutSettings.layout,
        corner: layoutSettings.corner,
        box: boxSettings.box,
        boxColor: boxSettings.boxColorAuto ? 'auto' : boxSettings.boxColor,
        boxThickness: boxSettings.boxThickness,
        boxBackground: boxSettings.boxBackground ? boxSettings.boxBackground : undefined,
        boxOpacity: boxSettings.boxOpacity ? boxSettings.boxOpacity : undefined,
        displayWidth: {
          type: verticalDimensions.displayWidthType,
          val: verticalDimensions.displayWidthVal,
        },
        displayHeight: {
          type: verticalDimensions.displayHeightType,
          val: verticalDimensions.displayHeightVal,
        },
      });
    };
    // Watch doesn't like arrays of reactive objects
    watch(mainSettings, () => updateSettings());
    watch(layoutSettings, () => updateSettings());
    watch(displayNameSettings, () => updateSettings());
    watch(valueSettings, () => updateSettings());
    watch(verticalDimensions, () => updateSettings());
    watch(boxSettings, () => updateSettings());

    const setEditingColor = (key: string, state: boolean) => {
      if (!state) { // skip if auto is set
        return;
      }
      currentEditColorType.value = key;
      if (currentEditColorType.value === 'display') {
        currentEditColor.value = computedDisplayColor.value;
      }
      if (currentEditColorType.value === 'value') {
        currentEditColor.value = computedValueColor.value;
      }
      if (currentEditColorType.value === 'box') {
        currentEditColor.value = computedBoxColor.value;
      }
      if (currentEditColorType.value === 'boxBackground') {
        currentEditColor.value = boxSettings.boxBackground ? boxSettings.boxBackground : 'white';
      }
      editingColor.value = true;
    };
    const saveEditingColor = () => {
      if (currentEditColorType.value === 'display') {
        displayNameSettings.displayColor = currentEditColor.value;
      }
      if (currentEditColorType.value === 'value') {
        valueSettings.valueColor = currentEditColor.value;
      }
      if (currentEditColorType.value === 'box') {
        boxSettings.boxColor = currentEditColor.value;
      }
      if (currentEditColorType.value === 'boxBackground') {
        boxSettings.boxBackground = currentEditColor.value;
      }

      editingColor.value = false;
    };

    watch(() => boxSettings.boxBackgroundSwitch, () => {
      if (boxSettings.boxBackgroundSwitch && boxSettings.boxBackground === undefined) {
        boxSettings.boxBackground = 'white';
        boxSettings.boxOpacity = 0;
      } else if (!boxSettings.boxBackgroundSwitch && boxSettings.boxBackground) {
        boxSettings.boxBackground = undefined;
        boxSettings.boxOpacity = undefined;
      }
    });
    return {
      //dropdowns
      dropdownOptions,
      mainSettings,
      displayNameSettings,
      valueSettings,
      layoutSettings,
      boxSettings,
      verticalDimensions,
      // computed
      computedDisplayColor,
      computedValueColor,
      computedBoxColor,
      // color Editing
      editingColor,
      currentEditColor,
      currentEditColorType,
      setEditingColor,
      saveEditingColor,
      // type filter
      typeStylingRef,
      types,
      deleteChip,
    };
  },
});
</script>
<template>
  <div>
    <v-expansion-panels>
      <v-expansion-panel>
        <v-expansion-panel-header>
          <h3>
            Main Settings
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <v-icon v-on="on">
                  mdi-information
                </v-icon>
              </template>
              <span>
                <ul>
                  <li><b>Selected Track</b> : Only display attributes when a track is selected</li>
                  <li><b>Filter Types</b> : Only display attributes on the filtered types</li>
                  <li><b>Order</b> : Order top to bottom for attributes where 0 is higher</li>
                </ul>
              </span>
            </v-tooltip>
          </h3>
        </v-expansion-panel-header>
        <v-expansion-panel-content>
          <v-row class="my-2 border">
            <v-switch
              v-model="mainSettings.selected"
              label="Selected Track"
              hint="Only display on selected Track"
              persistent-hint
              class="mx-2"
            />
            <v-select
              v-model="mainSettings.typeFilter"
              :items="types"
              multiple
              clearable
              deletable-chips
              chips
              label="Filter Types"
              class="mx-2"
              style="max-width:250px"
            >
              <template #selection="{ item }">
                <v-chip
                  close
                  :color="typeStylingRef.color(item)"
                  text-color="gray"
                  @click:close="deleteChip(item)"
                >
                  {{ item }}
                </v-chip>
              </template>
            </v-select>
            <v-text-field
              v-model.number="mainSettings.order"
              type="number"
              label="Order"
              step="1"
              hint="Top to bottom, lower is higher"
              persistent-hint
              class="mx-2"
            />
          </v-row>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel>
        <v-expansion-panel-header>
          <h3>
            Layout
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <v-icon v-on="on">
                  mdi-information
                </v-icon>
              </template>
              <span>
                <ul>
                  <li><b>Location</b> : Display attributes inside or outside of the track box</li>
                  <li><b>Layout</b> : Vertically stacked attributes or horizontal like confidence pairs</li>
                  <li><b>Corner</b> : Which corner to place the list of attributes in</li>
                </ul>
              </span>
            </v-tooltip>
          </h3>
        </v-expansion-panel-header>
        <v-expansion-panel-content>
          <v-row class="my-2 border">
            <v-select
              v-model="layoutSettings.location"
              :items="dropdownOptions.locationOptions"
              label="Location"
              class="mx-2"
              style="max-width:100px"
            />
            <v-select
              v-model="layoutSettings.layout"
              :items="dropdownOptions.layoutOptions"
              label="Layout"
              class="mx-2"
              style="max-width:100px"
            />
            <v-select
              v-model="layoutSettings.corner"
              :items="dropdownOptions.cornerOptions"
              label="Corner"
              class="mx-2"
              style="max-width:100px"
            />
          </v-row>
        </v-expansion-panel-content>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-header>
          <h3>
            Display Name
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <v-icon v-on="on">
                  mdi-information
                </v-icon>
              </template>
              <span>
                <ul>
                  <li><b>Display Name</b> : Label that is displayed for attribute, auto-populates to the attribute name</li>
                  <li><b>Display Text Size</b> : Pixel font size for the attribute display name (-1 is auto)</li>
                  <li><b>Color</b> : Color of the text, auto will use attribute color</li>
                </ul>
              </span>
            </v-tooltip>
          </h3>
        </v-expansion-panel-header>
        <v-expansion-panel-content>
          <v-row class="mb-2 border">
            <v-text-field
              v-model="displayNameSettings.displayName"
              label="Display Name"
              class="mx-2"
            />
            <v-text-field
              v-model.number="displayNameSettings.displayTextSize"
              type="number"
              step="1"
              label="Display Text Size"
              class="mx-2"
            />
            <v-switch
              v-model="displayNameSettings.displayColorAuto"
              label="Auto Color"
              class="mx-2"
            />
            <div
              class="color-box mx-2 mt-5"
              :class="{'edit-color-box': !displayNameSettings.displayColorAuto}"
              :style="{
                backgroundColor: computedDisplayColor,
              }"
              @click="setEditingColor('display', !displayNameSettings.displayColorAuto)"
            />
          </v-row>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel>
        <v-expansion-panel-header>
          <h3>
            Value
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <v-icon v-on="on">
                  mdi-information
                </v-icon>
              </template>
              <span>
                <ul>
                  <li><b>Value Text Size</b> : Pixel font size for the attribute display name (-1 is auto)</li>
                  <li><b>Color</b> : Color of the text, auto will use attribute color</li>
                </ul>
              </span>
            </v-tooltip>
          </h3>
        </v-expansion-panel-header>
        <v-expansion-panel-content>
          <v-row class="mb-2 border">
            <v-text-field
              v-model.number="valueSettings.valueTextSize"
              type="number"
              step="1"
              label="Value Text Size"
              class="mx-2"
            />
            <v-switch
              v-model="valueSettings.valueColorAuto"
              label="Auto Color"
              class="mx-2"
            />
            <div
              class="color-box mx-2 mt-5"
              :class="{'edit-color-box': !valueSettings.valueColorAuto}"
              :style="{
                backgroundColor: computedValueColor,
              }"
              @click="setEditingColor('value', !valueSettings.valueColorAuto)"
            />
          </v-row>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel v-if="layoutSettings.layout === 'vertical'">
        <v-expansion-panel-header>
          <h3>
            Dimensions
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <v-icon v-on="on">
                  mdi-information
                </v-icon>
              </template>
              <span>
                <p>This specifies the dimensions of the area surrounding the attribute area</p>
                <ul>
                  <li><b>Type %</b> : Uses a the track width/length to caclulate a percentage using the value to size the area for the attribute</li>
                  <li><b>Type px</b> : A default pixel value for the width/height of the track, it is suggested to use a pixel value if you have varying widths of tracks</li>
                  <li><b>Type auto</b>: For Height values only it will auto use the space to evenly distribute attributes along the height of the track</li>
                </ul>
              </span>
            </v-tooltip>
          </h3>
        </v-expansion-panel-header>
        <v-expansion-panel-content>
          <v-row class="border mb-2">
            <v-row dense>
              <v-select
                v-model="verticalDimensions.displayWidthType"
                :items="['%', 'px']"
                label="Width Type"
                class="mx-2"
              />
              <v-text-field
                v-model.number="verticalDimensions.displayWidthVal"
                label="Value"
                type="number"
                step="1"
                class="mx-2"
              />
            </v-row>
            <v-row dense>
              <v-select
                v-model="verticalDimensions.displayHeightType"
                :items="dropdownOptions.displayDimOptions"
                label="Height Type"
                class="mx-2"
              />
              <v-text-field
                v-model.number="verticalDimensions.displayHeightVal"
                label="Value"
                type="number"
                step="1"
                class="mx-2"
              />
            </v-row>
          </v-row>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel v-if="layoutSettings.layout === 'vertical'">
        <v-expansion-panel-header>
          <h3>
            Box
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <v-icon v-on="on">
                  mdi-information
                </v-icon>
              </template>
              <span>
                <p>Drawing a box around the area for the attribute</p>
              </span>
            </v-tooltip>
          </h3>
        </v-expansion-panel-header>
        <v-expansion-panel-content>
          <v-row class="my-2 border">
            <v-row dense>
              <v-switch
                v-model="boxSettings.box"
                label="Draw Box"
                class="mx-2"
              />
              <v-text-field
                v-if="boxSettings.box"
                v-model.number="boxSettings.boxThickness"
                label="Thickness"
                type="number"
                step="1"
                class="mx-2"
                style="max-width:75px;"
              />
              <v-switch
                v-if="boxSettings.box"
                v-model="boxSettings.boxColorAuto"
                label="Auto Color"
                class="mx-2"
              />
              <div
                v-if="boxSettings.box"
                class="color-box mx-2 mt-5"
                :class="{'edit-color-box': !boxSettings.boxColorAuto}"
                :style="{
                  backgroundColor: computedBoxColor,
                }"
                @click="setEditingColor('box', !boxSettings.boxColorAuto)"
              />
            </v-row>
            <v-row
              v-if="boxSettings.box"
              dense
            >
              <v-switch
                v-model="boxSettings.boxBackgroundSwitch"
                label="Box Background"
                class="mx-2"
              />
              <div
                v-if="boxSettings.boxBackgroundSwitch"
                class="color-box mx-2 mt-2 edit-color-box"
                :style="{
                  backgroundColor: boxSettings.boxBackground,
                }"
                @click="setEditingColor('boxBackground', true)"
              />
              <v-slider
                v-if="boxSettings.boxBackgroundSwitch"
                v-model.number="boxSettings.boxOpacity"
                :label="`Opacity (${boxSettings.boxOpacity})`"
                min="0"
                max="1"
                step="0.01"
                class="mx-2"
              />
            </v-row>
          </v-row>
        </v-expansion-panel-content>
      </v-expansion-panel>
    </v-expansion-panels>
    <v-dialog
      v-model="editingColor"
      max-width="300"
    >
      <v-card>
        <v-card-title>
          Edit color
        </v-card-title>
        <v-card-text>
          <v-color-picker
            v-model="currentEditColor"
            hide-inputs
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            depressed
            text
            @click="editingColor = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            @click="saveEditingColor"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style lang="scss">
.color-box {
  display: inline-block;
  margin-left: 20px;
  min-width: 50px;
  max-width: 50px;
  min-height: 50px;
  max-height: 50px;
}
.edit-color-box {
  &:hover {
    cursor: pointer;
    border: 2px solid white
  }
}
.border {
  border: 2px solid gray;
}

</style>
