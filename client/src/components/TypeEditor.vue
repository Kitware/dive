<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, reactive, toRef, unref, watch,
} from 'vue';

import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { compareTypeNames, TypeHierarchyError } from 'dive-common/typeHierarchy';

import TrackFilterControls from '../TrackFilterControls';
import BaseFilterControls from '../BaseFilterControls';
import type Group from '../Group';
import type StyleManager from '../StyleManager';
import type Track from '../track';
import { useReadOnlyMode } from '../provides';

const MAX_PARENT_OPTIONS = 50;

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
    const trackFilters = computed(() => (
      props.filterControls instanceof TrackFilterControls ? props.filterControls : undefined
    ));
    const isStyleOnly = computed(() => props.styleOnly || !props.filterControls);
    const showParentType = computed(() => (
      !props.group && !isStyleOnly.value && trackFilters.value !== undefined
    ));
    const usedTypesRef = computed(() => props.filterControls?.usedTypes.value ?? []);
    const readOnlyMode = useReadOnlyMode();
    const { prompt } = usePrompt();
    let active = true;
    onBeforeUnmount(() => {
      active = false;
    });

    const data = reactive({
      selectedColor: '',
      selectedType: '',
      editingType: '',
      editingParent: null as string | null,
      parentSearch: null as string | null,
      editingColor: '',
      editingThickness: 5,
      editingFill: false,
      editingOpacity: 1.0,
      editingShowLabel: true,
      editingShowConfidence: true,
      valid: true,
      definitionError: '',
    });

    const parentQuery = computed(() => {
      const search = data.parentSearch ?? '';
      return search === data.editingParent ? '' : search;
    });
    const parentOptions = computed(() => {
      const controls = trackFilters.value;
      if (!controls) {
        return [];
      }
      const excluded = new Set([data.selectedType, data.editingType]);
      const query = parentQuery.value.toLowerCase();
      const prefixMatches: string[] = [];
      const substringMatches: string[] = [];
      controls.allTypes.value.forEach((type) => {
        if (excluded.has(type)) {
          return;
        }
        const candidate = type.toLowerCase();
        if (candidate.startsWith(query)) {
          prefixMatches.push(type);
        } else if (candidate.includes(query)) {
          substringMatches.push(type);
        }
      });
      prefixMatches.sort(compareTypeNames);
      substringMatches.sort(compareTypeNames);

      const currentParent = data.editingParent;
      const options = [...prefixMatches, ...substringMatches]
        .filter((type) => type !== currentParent);
      if (currentParent !== null && !excluded.has(currentParent)) {
        options.unshift(currentParent);
      }
      return options.slice(0, MAX_PARENT_OPTIONS);
    });
    const parentSearchUnresolved = computed(() => {
      const search = data.parentSearch;
      return search !== null && search !== '' && search !== data.editingParent;
    });

    const currentStyleValue = () => ({
      color: data.editingColor,
      strokeWidth: data.editingThickness,
      fill: data.editingFill,
      opacity: data.editingOpacity,
      showLabel: data.editingShowLabel,
      showConfidence: data.editingShowConfidence,
    });
    let styleSnapshot = currentStyleValue();

    function acceptChanges() {
      if (!data.valid || parentSearchUnresolved.value) {
        return;
      }
      data.definitionError = '';
      if (isStyleOnly.value) {
        if (data.editingType !== data.selectedType) {
          props.styleManager.renameTypeStyle(data.selectedType, data.editingType);
        }
      } else if (trackFilters.value) {
        try {
          trackFilters.value.updateTypeDefinition({
            currentType: data.selectedType,
            newType: data.editingType,
            parent: data.editingParent ?? undefined,
          });
        } catch (error) {
          if (error instanceof TypeHierarchyError) {
            data.definitionError = `Type hierarchy is invalid: ${error.reason}. No type changes were applied.`;
            return;
          }
          throw error;
        }
      } else if (props.filterControls && data.editingType !== data.selectedType) {
        props.filterControls.updateTypeName({
          currentType: data.selectedType,
          newType: data.editingType,
        });
      }
      const styleValue = currentStyleValue();
      const styleChanged = Object.entries(styleValue).some(
        ([key, value]) => styleSnapshot[key as keyof typeof styleSnapshot] !== value,
      );
      if (styleChanged && trackFilters.value) {
        trackFilters.value.importTypes([data.editingType], false);
      }
      props.styleManager.updateTypeStyle({ type: data.editingType, value: styleValue });
      emit('close');
    }

    async function clickDeleteType(type: string) {
      if (isStyleOnly.value) {
        const result = await prompt({
          title: 'Confirm',
          text: `Do you want to delete the saved style for "${type}"?`,
          confirm: true,
        });
        if (result && active) {
          props.styleManager.deleteTypeStyle(type);
          emit('close');
        }
        return;
      }
      const hierarchy = trackFilters.value?.typeHierarchy.value;
      const hasChildren = hierarchy
        ? Object.values(hierarchy).some((parent) => parent === type)
        : false;
      let text = `Delete the unused type "${type}"?`;
      if (hasChildren) {
        const parent = hierarchy?.[type];
        text = parent
          ? `Remove "${type}" from the hierarchy? Its children will move under "${parent}". Stored annotations will not be changed.`
          : `Remove "${type}" from the hierarchy? Its children will become top-level types. Stored annotations will not be changed.`;
      }
      const result = await prompt({
        title: 'Confirm',
        text,
        confirm: true,
      });
      if (result && active && props.filterControls) {
        if (props.filterControls.deleteType(type)) {
          emit('close');
        }
      }
    }

    function init() {
      data.selectedType = props.selectedType;
      data.editingType = props.selectedType;
      data.editingParent = trackFilters.value?.typeHierarchy.value?.[props.selectedType] ?? null;
      data.parentSearch = data.editingParent;
      const typeStyling = props.styleManager.typeStyling.value;
      data.editingColor = typeStyling.color(props.selectedType);
      data.editingThickness = typeStyling.strokeWidth(props.selectedType);
      data.editingFill = typeStyling.fill(props.selectedType);
      data.editingOpacity = typeStyling.opacity(props.selectedType);
      const labelSettings = typeStyling.labelSettings(props.selectedType);
      data.editingShowConfidence = labelSettings.showConfidence;
      data.editingShowLabel = labelSettings.showLabel;
      data.definitionError = '';
      styleSnapshot = currentStyleValue();
    }
    watch(toRef(props, 'selectedType'), init);
    init();

    const nameRules = [(val: string) => !!val?.trim() || 'Name is required'];
    const thicknessRules = [(val: number) => val >= 0 || 'Must be >= 0'];

    return {
      data,
      isStyleOnly,
      showParentType,
      readOnlyMode,
      parentOptions,
      parentSearchUnresolved,
      acceptChanges,
      clickDeleteType,
      nameRules,
      thicknessRules,
      deleteBlocked: computed(() => (
        unref(usedTypesRef).includes(data.selectedType)
        || (trackFilters.value?.typeInUseOnAnyCamera(data.selectedType) ?? false)
      )),
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
        <v-alert
          v-if="data.definitionError"
          type="error"
          dense
        >
          {{ data.definitionError }}
        </v-alert>
        <v-form v-model="data.valid">
          <v-row>
            <v-col clas="py-0">
              <v-text-field
                v-model="data.editingType"
                :disabled="readOnlyMode"
                :rules="nameRules"
                :label="readOnlyMode
                  ? 'Type Name (disabled in ReadOnly Mode)'
                  : (isStyleOnly ? 'Style Name' : 'Type Name')"
                hide-details="auto"
              />
            </v-col>
          </v-row>
          <v-row v-if="showParentType">
            <v-col>
              <v-autocomplete
                v-model="data.editingParent"
                :search-input.sync="data.parentSearch"
                :items="parentOptions"
                no-filter
                :disabled="readOnlyMode"
                label="Parent Type"
                placeholder="Top level"
                hint="Select the immediate parent. Clear to make this type top-level."
                no-data-text="No matching type. Add it from Type Settings first."
                clearable
                auto-select-first
                persistent-hint
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
          :color="(!isStyleOnly && deleteBlocked) ? 'error' : ''"
        >
          <template #activator="{ on }">
            <div v-on="on">
              <v-btn
                class="hover-show-child"
                :disabled="!isStyleOnly && deleteBlocked"
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
              : 'Only types without annotations can be deleted.' }}
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
          :disabled="!data.valid || parentSearchUnresolved"
          @click="acceptChanges"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>
