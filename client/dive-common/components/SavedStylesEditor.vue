<script lang="ts">
import {
  computed, defineComponent, onMounted, PropType, ref, watch,
} from 'vue';
import { noop } from 'lodash';

import { useApi } from 'dive-common/apispec';
import type { GlobalStyleSettings } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import StyleManager from 'vue-media-annotator/StyleManager';
import type { CustomStyle } from 'vue-media-annotator/StyleManager';
import TypeEditor from 'vue-media-annotator/components/TypeEditor.vue';

type StyleKind = 'type' | 'group';

interface StyleListItem {
  name: string;
  color: string;
  kind: StyleKind;
  sourceDatasetId?: string;
  sourceDatasetName?: string;
}

const BUILTIN_STYLE_KEYS = new Set(['no-group']);
const ALL_DATASETS_FILTER = '';
const UNKNOWN_DATASET_FILTER = '__unknown__';

function omitBuiltinStyles(
  styles: Record<string, CustomStyle>,
): Record<string, CustomStyle> {
  const result: Record<string, CustomStyle> = {};
  Object.entries(styles).forEach(([name, style]) => {
    if (!BUILTIN_STYLE_KEYS.has(name)) {
      result[name] = style;
    }
  });
  return result;
}

function styleSourceLabel(item: Pick<StyleListItem, 'sourceDatasetName' | 'sourceDatasetId'>) {
  if (item.sourceDatasetName) {
    return item.sourceDatasetName;
  }
  if (item.sourceDatasetId) {
    return item.sourceDatasetId;
  }
  return 'Unknown dataset';
}

function styleSourceKey(item: Pick<StyleListItem, 'sourceDatasetName' | 'sourceDatasetId'>) {
  if (item.sourceDatasetId) {
    return item.sourceDatasetId;
  }
  if (item.sourceDatasetName) {
    return `name:${item.sourceDatasetName}`;
  }
  return UNKNOWN_DATASET_FILTER;
}

export default defineComponent({
  name: 'SavedStylesEditor',

  components: { TypeEditor },

  props: {
    /**
     * When true, reload styles from disk/localStorage. Parent can toggle this
     * when opening a containing dialog.
     */
    active: {
      type: Boolean,
      default: true,
    },
    /** Optional hint shown under the title. */
    hint: {
      type: String as PropType<string>,
      default: 'Styles saved for reuse across datasets when type color scope is Shared.',
    },
  },

  setup(props, { emit }) {
    const { loadGlobalStyleSettings, saveGlobalStyleSettings } = useApi();
    const { prompt } = usePrompt();

    const loading = ref(false);
    const saving = ref(false);
    /** undefined = collapsed (default). */
    const expanded = ref<number | undefined>(undefined);
    const tab = ref(0);
    const search = ref('');
    const datasetFilter = ref(ALL_DATASETS_FILTER);
    /** Selection keyed as `${kind}:${name}`. Set avoids O(N²) checkbox array sync. */
    const selectedKeys = ref(new Set<string>());
    const showEditor = ref(false);
    const showAdd = ref(false);
    const addName = ref('');
    const selectedType = ref('');
    const editingKind = ref<StyleKind>('type');
    const error = ref<string | null>(null);

    let persistSuspended = false;

    const typeStyleManager = new StyleManager({
      markChangesPending: noop,
      onStyleEdit: () => {
        if (!persistSuspended) {
          persist();
        }
      },
    });
    const groupStyleManager = new StyleManager({
      markChangesPending: noop,
      onStyleEdit: () => {
        if (!persistSuspended) {
          persist();
        }
      },
    });

    const activeManager = computed(() => (
      editingKind.value === 'group' ? groupStyleManager : typeStyleManager
    ));

    function itemKey(item: StyleListItem) {
      return `${item.kind}:${item.name}`;
    }

    function matchesSearch(item: StyleListItem) {
      const q = search.value.trim().toLowerCase();
      if (!q) {
        return true;
      }
      const haystack = [
        item.name,
        item.sourceDatasetName,
        item.sourceDatasetId,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    }

    function matchesDataset(item: StyleListItem) {
      const filter = datasetFilter.value;
      if (!filter) {
        return true;
      }
      return styleSourceKey(item) === filter;
    }

    function toListItems(
      manager: StyleManager,
      kind: StyleKind,
    ): StyleListItem[] {
      const styles = omitBuiltinStyles(manager.customStyles.value);
      return Object.entries(styles)
        .map(([name, style]) => ({
          name,
          color: manager.typeStyling.value.color(name),
          kind,
          sourceDatasetId: style.sourceDatasetId,
          sourceDatasetName: style.sourceDatasetName,
        }))
        .filter(matchesSearch)
        .filter(matchesDataset)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const typeItems = computed((): StyleListItem[] => {
      if (typeStyleManager.revisionCounter.value) noop();
      return toListItems(typeStyleManager, 'type');
    });

    const groupItems = computed((): StyleListItem[] => {
      if (groupStyleManager.revisionCounter.value) noop();
      return toListItems(groupStyleManager, 'group');
    });

    const typeCount = computed(() => {
      if (typeStyleManager.revisionCounter.value) noop();
      return Object.keys(omitBuiltinStyles(typeStyleManager.customStyles.value)).length;
    });

    const groupCount = computed(() => {
      if (groupStyleManager.revisionCounter.value) noop();
      return Object.keys(omitBuiltinStyles(groupStyleManager.customStyles.value)).length;
    });

    const totalCount = computed(() => typeCount.value + groupCount.value);

    const datasetFilterItems = computed(() => {
      if (typeStyleManager.revisionCounter.value) noop();
      if (groupStyleManager.revisionCounter.value) noop();
      const byKey = new Map<string, string>();
      const collect = (manager: StyleManager) => {
        Object.values(omitBuiltinStyles(manager.customStyles.value)).forEach((style) => {
          const key = styleSourceKey(style);
          if (!byKey.has(key)) {
            byKey.set(key, styleSourceLabel(style));
          }
        });
      };
      collect(typeStyleManager);
      collect(groupStyleManager);
      const items = Array.from(byKey.entries())
        .map(([value, text]) => ({ value, text }))
        .sort((a, b) => a.text.localeCompare(b.text));
      return [
        { value: ALL_DATASETS_FILTER, text: 'All datasets' },
        ...items,
      ];
    });

    const visibleItems = computed(() => (
      tab.value === 1 ? groupItems.value : typeItems.value
    ));

    const selectedVisibleCount = computed(() => (
      visibleItems.value.reduce(
        (count, item) => count + (selectedKeys.value.has(itemKey(item)) ? 1 : 0),
        0,
      )
    ));

    const allVisibleSelected = computed(() => (
      visibleItems.value.length > 0
      && selectedVisibleCount.value === visibleItems.value.length
    ));

    function isSelected(item: StyleListItem) {
      return selectedKeys.value.has(itemKey(item));
    }

    function toggleSelected(item: StyleListItem) {
      const key = itemKey(item);
      const next = new Set(selectedKeys.value);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      selectedKeys.value = next;
    }

    function currentSettings(): GlobalStyleSettings {
      return {
        customTypeStyling: omitBuiltinStyles(typeStyleManager.customStyles.value),
        customGroupStyling: omitBuiltinStyles(groupStyleManager.customStyles.value),
      };
    }

    async function persist() {
      if (!saveGlobalStyleSettings) {
        return;
      }
      saving.value = true;
      error.value = null;
      try {
        const settings = currentSettings();
        await saveGlobalStyleSettings(settings);
        emit('change', settings);
      } catch (err) {
        error.value = err instanceof Error ? err.message : 'Failed to save styles';
      } finally {
        saving.value = false;
      }
    }

    async function load() {
      if (!loadGlobalStyleSettings) {
        typeStyleManager.populateTypeStyles({});
        groupStyleManager.populateTypeStyles({});
        return;
      }
      loading.value = true;
      error.value = null;
      persistSuspended = true;
      selectedKeys.value = new Set();
      try {
        const shared = await loadGlobalStyleSettings();
        typeStyleManager.populateTypeStyles(shared.customTypeStyling ?? {});
        groupStyleManager.populateTypeStyles(shared.customGroupStyling ?? {});
      } catch (err) {
        error.value = err instanceof Error ? err.message : 'Failed to load styles';
        typeStyleManager.populateTypeStyles({});
        groupStyleManager.populateTypeStyles({});
      } finally {
        persistSuspended = false;
        loading.value = false;
      }
    }

    function openEdit(item: StyleListItem) {
      editingKind.value = item.kind;
      selectedType.value = item.name;
      showEditor.value = true;
    }

    function openAdd(kind: StyleKind) {
      editingKind.value = kind;
      addName.value = '';
      showAdd.value = true;
    }

    async function confirmAdd() {
      const name = addName.value.trim();
      if (!name) {
        return;
      }
      const manager = activeManager.value;
      const existing = omitBuiltinStyles(manager.customStyles.value);
      if (name in existing) {
        await prompt({
          title: 'Style exists',
          text: `A saved style named "${name}" already exists.`,
          confirm: false,
        });
        return;
      }
      persistSuspended = true;
      manager.updateTypeStyle({
        type: name,
        value: {
          color: manager.typeStyling.value.color(name),
          strokeWidth: 3,
          fill: false,
          opacity: 1,
          showLabel: true,
          showConfidence: true,
        },
      });
      persistSuspended = false;
      showAdd.value = false;
      selectedType.value = name;
      showEditor.value = true;
      await persist();
    }

    async function deleteStyle(item: StyleListItem) {
      const result = await prompt({
        title: 'Confirm',
        text: `Do you want to delete the saved style for "${item.name}"?`,
        confirm: true,
      });
      if (!result) {
        return;
      }
      const manager = item.kind === 'group' ? groupStyleManager : typeStyleManager;
      manager.deleteTypeStyle(item.name);
      const next = new Set(selectedKeys.value);
      next.delete(itemKey(item));
      selectedKeys.value = next;
    }

    async function deleteSelected() {
      const toDelete = visibleItems.value.filter((item) => selectedKeys.value.has(itemKey(item)));
      if (!toDelete.length) {
        return;
      }
      const result = await prompt({
        title: 'Confirm',
        text: `Delete ${toDelete.length} selected saved style${toDelete.length === 1 ? '' : 's'}?`,
        confirm: true,
      });
      if (!result) {
        return;
      }
      persistSuspended = true;
      toDelete.forEach((item) => {
        const manager = item.kind === 'group' ? groupStyleManager : typeStyleManager;
        manager.deleteTypeStyle(item.name);
      });
      persistSuspended = false;
      const next = new Set(selectedKeys.value);
      toDelete.forEach((item) => next.delete(itemKey(item)));
      selectedKeys.value = next;
      await persist();
    }

    function toggleSelectAllVisible() {
      const next = new Set(selectedKeys.value);
      if (allVisibleSelected.value) {
        visibleItems.value.forEach((item) => next.delete(itemKey(item)));
      } else {
        visibleItems.value.forEach((item) => next.add(itemKey(item)));
      }
      selectedKeys.value = next;
    }

    watch(() => props.active, (active) => {
      if (active) {
        load();
      }
    });

    onMounted(() => {
      if (props.active) {
        load();
      }
    });

    return {
      loading,
      saving,
      expanded,
      tab,
      search,
      datasetFilter,
      datasetFilterItems,
      selectedKeys,
      showEditor,
      showAdd,
      addName,
      selectedType,
      editingKind,
      error,
      typeItems,
      groupItems,
      typeCount,
      groupCount,
      totalCount,
      typeStyleManager,
      groupStyleManager,
      activeManager,
      selectedVisibleCount,
      allVisibleSelected,
      isSelected,
      toggleSelected,
      itemKey,
      styleSourceLabel,
      openEdit,
      openAdd,
      confirmAdd,
      deleteStyle,
      deleteSelected,
      toggleSelectAllVisible,
      load,
    };
  },
});
</script>

<template>
  <div class="saved-styles-editor">
    <v-expansion-panels
      v-model="expanded"
      flat
      accordion
    >
      <v-expansion-panel>
        <v-expansion-panel-header class="px-0">
          <div class="d-flex align-center pr-2">
            <span class="text-subtitle-1">
              Saved Styles
            </span>
            <span class="text-caption grey--text ml-2">
              ({{ totalCount }})
            </span>
            <v-progress-circular
              v-if="loading || saving"
              indeterminate
              size="16"
              width="2"
              class="ml-2"
            />
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content class="px-0">
          <div
            v-if="hint"
            class="text-caption grey--text mb-2"
          >
            {{ hint }}
          </div>
          <v-alert
            v-if="error"
            dense
            text
            type="error"
            class="mb-2"
          >
            {{ error }}
          </v-alert>

          <div class="d-flex align-center mb-2">
            <v-text-field
              v-model="search"
              dense
              outlined
              hide-details
              clearable
              prepend-inner-icon="mdi-magnify"
              label="Filter styles"
              class="flex-grow-1 mr-2"
            />
            <v-btn
              small
              text
              color="primary"
              :disabled="loading"
              @click="openAdd(tab === 1 ? 'group' : 'type')"
            >
              <v-icon
                left
                small
              >
                mdi-plus
              </v-icon>
              Add
            </v-btn>
          </div>

          <div class="d-flex align-center mb-2">
            <v-select
              v-model="datasetFilter"
              :items="datasetFilterItems"
              dense
              outlined
              hide-details
              label="Dataset"
              class="flex-grow-1 mr-2"
            />
            <v-btn
              small
              text
              color="error"
              :disabled="loading || selectedVisibleCount === 0"
              @click="deleteSelected"
            >
              <v-icon
                left
                small
              >
                mdi-delete
              </v-icon>
              Delete ({{ selectedVisibleCount }})
            </v-btn>
          </div>

          <v-tabs
            v-model="tab"
            grow
            background-color="transparent"
            height="36"
          >
            <v-tab class="text-caption">
              Types ({{ typeCount }})
            </v-tab>
            <v-tab class="text-caption">
              Groups ({{ groupCount }})
            </v-tab>
          </v-tabs>

          <div class="d-flex align-center px-1 py-1">
            <v-simple-checkbox
              :value="allVisibleSelected"
              :indeterminate="selectedVisibleCount > 0 && !allVisibleSelected"
              :ripple="false"
              class="mt-0 pt-0"
              :disabled="loading || (tab === 1 ? !groupItems.length : !typeItems.length)"
              @input="toggleSelectAllVisible"
            />
            <span class="text-caption grey--text ml-1">
              Select all
            </span>
          </div>

          <v-tabs-items
            v-model="tab"
            class="transparent"
          >
            <v-tab-item>
              <v-list
                dense
                class="py-0 style-list"
              >
                <v-list-item
                  v-for="item in typeItems"
                  :key="`type-${item.name}`"
                  class="px-0 style-list-item"
                >
                  <v-list-item-action class="mr-1 style-list-action">
                    <v-simple-checkbox
                      :value="isSelected(item)"
                      :ripple="false"
                      @input="toggleSelected(item)"
                    />
                  </v-list-item-action>
                  <v-list-item-icon class="mr-3 style-list-icon">
                    <div
                      class="color-swatch"
                      :style="{ backgroundColor: item.color }"
                      :title="styleSourceLabel(item)"
                    />
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title class="text-body-2">
                      {{ item.name }}
                    </v-list-item-title>
                    <v-list-item-subtitle class="text-caption">
                      {{ styleSourceLabel(item) }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                  <v-list-item-action class="style-list-action style-list-buttons">
                    <v-btn
                      icon
                      small
                      @click="openEdit(item)"
                    >
                      <v-icon small>
                        mdi-pencil
                      </v-icon>
                    </v-btn>
                    <v-btn
                      icon
                      small
                      color="error"
                      @click="deleteStyle(item)"
                    >
                      <v-icon small>
                        mdi-delete
                      </v-icon>
                    </v-btn>
                  </v-list-item-action>
                </v-list-item>
                <div
                  v-if="!typeItems.length && !loading"
                  class="text-caption grey--text text-center py-4"
                >
                  {{ search.trim() || datasetFilter
                    ? 'No matching type styles.'
                    : 'No saved type styles yet.' }}
                </div>
              </v-list>
            </v-tab-item>
            <v-tab-item>
              <v-list
                dense
                class="py-0 style-list"
              >
                <v-list-item
                  v-for="item in groupItems"
                  :key="`group-${item.name}`"
                  class="px-0 style-list-item"
                >
                  <v-list-item-action class="mr-1 style-list-action">
                    <v-simple-checkbox
                      :value="isSelected(item)"
                      :ripple="false"
                      @input="toggleSelected(item)"
                    />
                  </v-list-item-action>
                  <v-list-item-icon class="mr-3 style-list-icon">
                    <div
                      class="color-swatch"
                      :style="{ backgroundColor: item.color }"
                      :title="styleSourceLabel(item)"
                    />
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title class="text-body-2">
                      {{ item.name }}
                    </v-list-item-title>
                    <v-list-item-subtitle class="text-caption">
                      {{ styleSourceLabel(item) }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                  <v-list-item-action class="style-list-action style-list-buttons">
                    <v-btn
                      icon
                      small
                      @click="openEdit(item)"
                    >
                      <v-icon small>
                        mdi-pencil
                      </v-icon>
                    </v-btn>
                    <v-btn
                      icon
                      small
                      color="error"
                      @click="deleteStyle(item)"
                    >
                      <v-icon small>
                        mdi-delete
                      </v-icon>
                    </v-btn>
                  </v-list-item-action>
                </v-list-item>
                <div
                  v-if="!groupItems.length && !loading"
                  class="text-caption grey--text text-center py-4"
                >
                  {{ search.trim() || datasetFilter
                    ? 'No matching group styles.'
                    : 'No saved group styles yet.' }}
                </div>
              </v-list>
            </v-tab-item>
          </v-tabs-items>
        </v-expansion-panel-content>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-dialog
      v-model="showAdd"
      width="360"
    >
      <v-card>
        <v-card-title>
          Add {{ editingKind === 'group' ? 'Group' : 'Type' }} Style
        </v-card-title>
        <v-card-text>
          <v-text-field
            v-model="addName"
            label="Style name"
            autofocus
            hide-details
            @keyup.enter="confirmAdd"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            text
            @click="showAdd = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            depressed
            :disabled="!addName.trim()"
            @click="confirmAdd"
          >
            Create
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="showEditor"
      width="350"
    >
      <TypeEditor
        v-if="showEditor"
        :selected-type="selectedType"
        :style-manager="activeManager"
        :group="editingKind === 'group'"
        style-only
        @close="showEditor = false"
      />
    </v-dialog>
  </div>
</template>

<style scoped lang="scss">
.style-list {
  max-height: 280px;
  overflow-y: auto;
}

.style-list-item {
  align-items: center;

  ::v-deep .v-list-item__action,
  ::v-deep .v-list-item__icon {
    align-self: center;
    margin-top: 0;
    margin-bottom: 0;
    height: auto;
  }

  ::v-deep .v-list-item__action {
    display: flex;
    align-items: center;
  }

  ::v-deep .style-list-buttons {
    flex-direction: row;
  }
}

.color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.35);
}
</style>
