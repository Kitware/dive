<!-- eslint-disable max-len -->
<script lang="ts">
import {
  defineComponent, ref, PropType, watch, computed, Ref,
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

    const typeFilter: Ref<string[]> = ref(props.value.typeFilter || ['all']);

    const deleteChip = (item: string) => {
      typeFilter.value.splice(typeFilter.value.findIndex((data) => data === item));
    };

    const selected = ref(props.value.selected || false);

    const displayName = ref(props.value.displayName);
    const displayTextSize = ref(props.value.displayTextSize);
    const valueTextSize = ref(props.value.valueTextSize);
    const displayColor = ref(props.value.displayColor);
    const displayColorAuto = ref(props.value.displayColor === 'auto');
    const valueColor = ref(props.value.valueColor);
    const valueColorAuto = ref(props.value.valueColor === 'auto');
    const order = ref(props.value.order);
    const locationOptions = ref(['inside', 'outside']);
    const location = ref(props.value.location);
    const box = ref(props.value.box);
    const boxColor = ref(props.value.boxColor);
    const boxColorAuto = ref(props.value.boxColor === 'auto');
    const boxThickness = ref(props.value.boxThickness);
    const boxBackground: Ref<string | undefined> = ref(props.value.boxBackground);
    const boxBackgroundSwitch = ref(!!props.value.boxBackground);
    const boxOpacity: Ref<number | undefined> = ref(props.value.boxOpacity);
    const layoutOptions = ref(['vertical', 'horizontal']);
    const layout = ref(props.value.layout);
    const displayDimOptions = ref(['px', '%', 'auto']);
    const displayWidthType = ref(props.value.displayWidth.type);
    const displayWidthVal = ref(props.value.displayWidth.val);
    const displayHeightType = ref(props.value.displayHeight.type);
    const displayHeightVal = ref(props.value.displayHeight.val);
    const currentEditColor = ref('');
    const currentEditColorType = ref('');
    const editingColor = ref(false);

    const computedDisplayColor = computed(() => {
      if (displayColorAuto.value || displayColor.value === 'auto') {
        return props.attribute.color || 'white';
      }
      return displayColor.value;
    });
    const computedValueColor = computed(() => {
      if (valueColorAuto.value || valueColor.value === 'auto') {
        return props.attribute.color || 'white';
      }
      return valueColor.value;
    });
    const computedBoxColor = computed(() => {
      if (boxColorAuto.value || boxColor.value === 'auto') {
        return props.attribute.color || 'white';
      }
      return boxColor.value;
    });

    watch([displayName, displayTextSize, valueTextSize, displayColor, valueColor, order,
      location, box, boxColor, boxThickness, layout, displayWidthType, displayWidthVal,
      displayHeightType, displayHeightVal, typeFilter, computedBoxColor,
      computedDisplayColor, computedValueColor, selected, boxBackground, boxOpacity, boxThickness], () => {
      emit('input', {
        selected: selected.value,
        typeFilter: typeFilter.value,
        displayName: displayName.value,
        displayTextSize: displayTextSize.value,
        valueTextSize: valueTextSize.value,
        displayColor: displayColorAuto.value ? 'auto' : displayColor.value,
        valueColor: valueColorAuto.value ? 'auto' : valueColor.value,
        order: order.value,
        location: location.value,
        box: box.value,
        boxColor: boxColorAuto.value ? 'auto' : boxColor.value,
        boxThickness: boxThickness.value,
        boxBackground: boxBackground.value ? boxBackground.value : undefined,
        boxOpacity: boxOpacity.value ? boxOpacity.value : undefined,
        layout: layout.value,
        displayWidth: {
          type: displayWidthType.value,
          val: displayWidthVal.value,
        },
        displayHeight: {
          type: displayHeightType.value,
          val: displayHeightVal.value,
        },
      });
    });
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
        currentEditColor.value = boxBackground.value ? boxBackground.value : 'white';
      }
      editingColor.value = true;
    };
    const saveEditingColor = () => {
      if (currentEditColorType.value === 'display') {
        displayColor.value = currentEditColor.value;
      }
      if (currentEditColorType.value === 'value') {
        valueColor.value = currentEditColor.value;
      }
      if (currentEditColorType.value === 'box') {
        boxColor.value = currentEditColor.value;
      }
      if (currentEditColorType.value === 'boxBackground') {
        boxBackground.value = currentEditColor.value;
      }

      editingColor.value = false;
    };

    watch(boxBackgroundSwitch, () => {
      if (boxBackgroundSwitch.value && boxBackground.value === undefined) {
        boxBackground.value = 'white';
        boxOpacity.value = 0;
      } else if (!boxBackgroundSwitch.value && boxBackground.value) {
        boxBackground.value = undefined;
        boxOpacity.value = undefined;
      }
    });
    return {
      displayName,
      displayTextSize,
      displayColor,
      valueTextSize,
      valueColor,
      order,
      location,
      layout,
      box,
      boxColor,
      boxThickness,
      boxOpacity,
      boxBackground,
      displayWidthType,
      displayWidthVal,
      displayHeightType,
      displayHeightVal,
      // Options
      locationOptions,
      layoutOptions,
      displayDimOptions,
      displayColorAuto,
      valueColorAuto,
      boxColorAuto,
      // computed
      computedDisplayColor,
      computedValueColor,
      computedBoxColor,
      // color Editing
      boxBackgroundSwitch,
      editingColor,
      currentEditColor,
      currentEditColorType,
      setEditingColor,
      saveEditingColor,
      // type filter
      selected,
      typeStylingRef,
      typeFilter,
      types,
      deleteChip,
    };
  },
});
</script>
<template>
  <div>
    <h3>
      Settings
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
    <v-row class="my-2 border">
      <v-switch
        v-model="selected"
        label="Selected Track"
        hint="Only display on selected Track"
        persistent-hint
        class="mx-2"
      />
      <v-select
        v-model="typeFilter"
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
        v-model.number="order"
        type="number"
        label="Order"
        step="1"
        hint="Top to bottom, lower is higher"
        persistent-hint
        class="mx-2"
      />
    </v-row>
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
            <li><b>Display Text Size</b> : Pixel font size for the attribute display name</li>
            <li><b>Color</b> : Color of the text, auto will use attribute color</li>
          </ul>
        </span>
      </v-tooltip>
    </h3>
    <v-row class="mb-2 border">
      <v-text-field
        v-model="displayName"
        label="Display Name"
        class="mx-2"
      />
      <v-text-field
        v-model.number="displayTextSize"
        type="number"
        step="1"
        label="Display Text Size"
        class="mx-2"
      />
      <v-switch
        v-model="displayColorAuto"
        label="Auto Color"
        class="mx-2"
      />
      <div
        class="color-box mx-2 mt-2"
        :class="{'edit-color-box': !displayColorAuto}"
        :style="{
          backgroundColor: computedDisplayColor,
        }"
        @click="setEditingColor('display', !displayColorAuto)"
      />
    </v-row>
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
            <li><b>Value Text Size</b> : Pixel font size for the attribute display name</li>
            <li><b>Color</b> : Color of the text, auto will use attribute color</li>
          </ul>
        </span>
      </v-tooltip>
    </h3>
    <v-row class="mb-2 border">
      <v-text-field
        v-model.number="valueTextSize"
        type="number"
        step="1"
        label="Value Text Size"
        class="mx-2"
      />
      <v-switch
        v-model="valueColorAuto"
        label="Auto Color"
        class="mx-2"
      />
      <div
        class="color-box mx-2 mt-2"
        :class="{'edit-color-box': !valueColorAuto}"
        :style="{
          backgroundColor: computedValueColor,
        }"
        @click="setEditingColor('value', !valueColorAuto)"
      />
    </v-row>
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
    <v-row class="border mb-2">
      <v-row dense>
        <v-select
          v-model="displayWidthType"
          :items="['%', 'px']"
          label="Width Type"
          class="mx-2"
        />
        <v-text-field
          v-model.number="displayWidthVal"
          label="Value"
          type="number"
          step="1"
          class="mx-2"
        />
      </v-row>
      <v-row dense>
        <v-select
          v-model="displayHeightType"
          :items="displayDimOptions"
          label="Height Type"
          class="mx-2"
        />
        <v-text-field
          v-model.number="displayHeightVal"
          label="Value"
          type="number"
          step="1"
          class="mx-2"
        />
      </v-row>
    </v-row>
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
    <v-row class="my-2 border">
      <v-row dense>
        <v-switch
          v-model="box"
          label="Draw Box"
          class="mx-2"
        />
        <v-text-field
          v-if="box"
          v-model.number="boxThickness"
          label="Thickness"
          type="number"
          step="1"
          class="mx-2"
          style="max-width:75px;"
        />
        <v-switch
          v-if="box"
          v-model="boxColorAuto"
          label="Auto Color"
          class="mx-2"
        />
        <div
          v-if="box"
          class="color-box mx-2 mt-2"
          :class="{'edit-color-box': !boxColorAuto}"
          :style="{
            backgroundColor: computedBoxColor,
          }"
          @click="setEditingColor('box', !boxColorAuto)"
        />
      </v-row>
      <v-row
        v-if="box"
        dense
      >
        <v-switch
          v-model="boxBackgroundSwitch"
          label="Box Background"
          class="mx-2"
        />
        <div
          v-if="boxBackgroundSwitch"
          class="color-box mx-2 mt-2 edit-color-box"
          :style="{
            backgroundColor: boxBackground,
          }"
          @click="setEditingColor('boxBackground', true)"
        />
        <v-slider
          v-if="boxBackgroundSwitch"
          v-model.number="boxOpacity"
          :label="`Opacity (${boxOpacity})`"
          min="0"
          max="1"
          step="0.01"
          class="mx-2"
        />
      </v-row>
    </v-row>
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
