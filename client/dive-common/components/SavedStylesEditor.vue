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
}

const BUILTIN_STYLE_KEYS = new Set(['no-group']);

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

    function matchesSearch(name: string) {
      const q = search.value.trim().toLowerCase();
      if (!q) {
        return true;
      }
      return name.toLowerCase().includes(q);
    }

    const typeItems = computed((): StyleListItem[] => {
      // Establish dependency on revision for list refresh after edits.
      if (typeStyleManager.revisionCounter.value) noop();
      const styles = omitBuiltinStyles(typeStyleManager.customStyles.value);
      return Object.keys(styles)
        .filter(matchesSearch)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          name,
          color: typeStyleManager.typeStyling.value.color(name),
          kind: 'type' as const,
        }));
    });

    const groupItems = computed((): StyleListItem[] => {
      if (groupStyleManager.revisionCounter.value) noop();
      const styles = omitBuiltinStyles(groupStyleManager.customStyles.value);
      return Object.keys(styles)
        .filter(matchesSearch)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          name,
          color: groupStyleManager.typeStyling.value.color(name),
          kind: 'group' as const,
        }));
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
      openEdit,
      openAdd,
      confirmAdd,
      deleteStyle,
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
                  class="px-0"
                >
                  <v-list-item-icon class="mr-3 my-2">
                    <div
                      class="color-swatch"
                      :style="{ backgroundColor: item.color }"
                    />
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title class="text-body-2">
                      {{ item.name }}
                    </v-list-item-title>
                  </v-list-item-content>
                  <v-list-item-action class="my-0 flex-row">
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
                  {{ search.trim() ? 'No matching type styles.' : 'No saved type styles yet.' }}
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
                  class="px-0"
                >
                  <v-list-item-icon class="mr-3 my-2">
                    <div
                      class="color-swatch"
                      :style="{ backgroundColor: item.color }"
                    />
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title class="text-body-2">
                      {{ item.name }}
                    </v-list-item-title>
                  </v-list-item-content>
                  <v-list-item-action class="my-0 flex-row">
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
                  {{ search.trim() ? 'No matching group styles.' : 'No saved group styles yet.' }}
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
  max-height: 240px;
  overflow-y: auto;
}

.color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.35);
}
</style>
