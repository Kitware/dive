<script lang="ts">
import {
  computed, defineComponent, PropType, reactive, toRef, watch,
} from 'vue';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

import TrackFilterControls from '../TrackFilterControls';
import BaseFilterControls from '../BaseFilterControls';
import type Group from '../Group';
import type StyleManager from '../StyleManager';
import type Track from '../track';
import { useCameraStore, useReadOnlyMode } from '../provides';

export default defineComponent({
  name: 'TypeEditor',

  props: {
    selectedType: {
      type: String,
      required: true,
    },
    /**
     * When omitted, the editor only updates StyleManager (rename/delete style
     * keys) and does not touch annotation type lists. Used by SavedStylesEditor.
     */
    filterControls: {
      type: Object as PropType<BaseFilterControls<Track | Group>>,
      default: undefined,
    },
    styleManager: {
      type: Object as PropType<StyleManager>,
      required: true,
    },
    group: {
      type: Boolean,
      default: false,
    },
    /** When true, Delete removes the style override rather than an empty type. */
    styleOnly: {
      type: Boolean,
      default: false,
    },
  },

  setup(props, { emit }) {
    const typeStylingRef = props.styleManager.typeStyling;
    const trackFilters = props.filterControls;
    const isStyleOnly = computed(() => props.styleOnly || !props.filterControls);
    const usedTypesRef = computed(() => trackFilters?.usedTypes.value ?? []);
    const readOnlyMode = useReadOnlyMode();
    const cameraStore = useCameraStore();
    const { prompt } = usePrompt();

    const data = reactive({
      selectedColor: '',
      selectedType: '',
      editingType: '',
      editingColor: '',
      editingThickness: 5,
      editingFill: false,
      editingOpacity: 1.0,
      editingShowLabel: true,
      editingShowConfidence: true,
      valid: true,
    });

    function acceptChanges() {
      if (data.editingType !== data.selectedType) {
        if (isStyleOnly.value) {
          props.styleManager.renameTypeStyle(data.selectedType, data.editingType);
        } else if (trackFilters) {
          const updatedTypeObj = {
            currentType: data.selectedType,
            newType: data.editingType,
          };
          trackFilters.updateTypeName(updatedTypeObj);
          if (trackFilters instanceof TrackFilterControls) {
            cameraStore.changeTrackTypes(updatedTypeObj);
          }
        }
      }
      props.styleManager.updateTypeStyle({
        type: data.editingType,
        value: {
          color: data.editingColor,
          strokeWidth: data.editingThickness,
          fill: data.editingFill,
          opacity: data.editingOpacity,
          showLabel: data.editingShowLabel,
          showConfidence: data.editingShowConfidence,
        },
      });
      emit('close');
    }

    async function clickDeleteType(type: string) {
      if (isStyleOnly.value) {
        const result = await prompt({
          title: 'Confirm',
          text: `Do you want to delete the saved style for "${type}"?`,
          confirm: true,
        });
        if (result) {
          props.styleManager.deleteTypeStyle(type);
          emit('close');
        }
        return;
      }
      const text = `Do you want to delete this empty Type: ${type}`;
      const result = await prompt({
        title: 'Confirm',
        text,
        confirm: true,
      });
      if (result && trackFilters) {
        trackFilters.deleteType(type);
        emit('close');
      }
    }

    function init() {
      data.selectedType = props.selectedType;
      data.editingType = props.selectedType;
      data.editingColor = typeStylingRef.value.color(props.selectedType);
      data.editingThickness = typeStylingRef.value.strokeWidth(props.selectedType);
      data.editingFill = typeStylingRef.value.fill(props.selectedType);
      data.editingOpacity = typeStylingRef.value.opacity(props.selectedType);
      const labelSettings = typeStylingRef.value.labelSettings(props.selectedType);
      data.editingShowConfidence = labelSettings.showConfidence;
      data.editingShowLabel = labelSettings.showLabel;
    }
    watch(toRef(props, 'selectedType'), init);
    init();

    const thicknessRules = [(val: number) => val >= 0 || 'Must be >= 0'];

    return {
      data,
      isStyleOnly,
      usedTypesRef,
      readOnlyMode,
      acceptChanges,
      clickDeleteType,
      thicknessRules,
    };
  },
});
</script>

<template>
  <div
    class="type-edit"
  >
    <v-card>
      <v-card-title>
        {{ isStyleOnly ? 'Editing Style' : 'Editing Type' }}
        <v-spacer />
        <v-btn
          icon
          small
          color="white"
          @click="$emit('close')"
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
            {{ data.selectedType }}
          </v-row>
        </v-container>
      </v-card-subtitle>
      <v-card-text>
        <v-form v-model="data.valid">
          <v-row>
            <v-col clas="py-0">
              <v-text-field
                v-model="data.editingType"
                :disabled="readOnlyMode"
                :label="readOnlyMode
                  ? 'Type Name (disabled in ReadOnly Mode)'
                  : (isStyleOnly ? 'Style Name' : 'Type Name')"
                hide-details
              />
            </v-col>
          </v-row>
          <v-row v-if="!group">
            <v-col>
              <v-checkbox
                v-model="data.editingShowLabel"
                label="Show Label"
                dense
                shrink
                hide-details
              />
              <v-checkbox
                v-model="data.editingShowConfidence"
                label="Show Confidence"
                dense
                shrink
                hide-details
              />
            </v-col>
          </v-row>

          <v-row class="align-center">
            <v-col>
              <v-text-field
                v-model="data.editingThickness"
                type="number"
                :rules="thicknessRules"
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
          v-if="!group || isStyleOnly"
          open-delay="100"
          bottom
          :color="(!isStyleOnly && usedTypesRef.includes(data.selectedType)) ? 'error' : ''"
        >
          <template #activator="{ on }">
            <div v-on="on">
              <v-btn
                class="hover-show-child"
                :disabled="!isStyleOnly && usedTypesRef.includes(data.selectedType)"
                small
                color="error"
                @click="clickDeleteType(data.selectedType)"
              >
                {{ isStyleOnly ? 'Delete Style' : 'Delete Type' }}
              </v-btn>
            </div>
          </template>
          <span
            class="ma-0 pa-1"
          >
            {{ isStyleOnly
              ? 'Remove this saved style override.'
              : 'Only types without any annotations can be deleted.' }}
          </span>
        </v-tooltip>
        <v-spacer />
        <v-btn
          depressed=""
          text
          @click="$emit('close')"
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
</template>
