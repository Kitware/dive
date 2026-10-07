<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { compileHierarchy } from 'dive-common/typeHierarchy';
import { useReadOnlyMode, useTrackFilters, useTrackStyleManager } from '../../provides';
import { buildTypeListModel } from './typeListHierarchy';
import TypeEditor from './TypeEditor.vue';

export default defineComponent({
  name: 'TypeManagementDialog',
  components: { TypeEditor },
  setup() {
    const filters = useTrackFilters();
    const styles = useTrackStyleManager();
    const readOnly = useReadOnlyMode();
    const query = ref('');
    const collapsed = ref(new Set<string>());
    const searching = computed(() => !!query.value);
    const parentTypes = computed(() => new Set(Object.values(filters.typeHierarchy.value ?? {})));
    function toggleBranch(type: string) {
      if (searching.value) return;
      const next = new Set(collapsed.value);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      collapsed.value = next;
    }
    function expandAll() { collapsed.value = new Set(); }
    function collapseAll() {
      if (!searching.value) collapsed.value = new Set(parentTypes.value);
    }
    const editing = ref<string | null>(null);
    const deleting = ref<string | null>(null);
    const deleteEmptyParents = ref(false);
    const deleteEmptyChildren = ref(false);
    const hasParent = computed(() => (
      deleting.value !== null && !!filters.typeHierarchy.value?.[deleting.value]
    ));
    const hasChildren = computed(() => (
      deleting.value !== null && parentTypes.value.has(deleting.value)
    ));
    const disposition = ref<'unknown' | 'delete' | null>(null);
    const error = ref('');
    const usage = computed(() => filters.typeTrackIds());
    const model = computed(() => buildTypeListModel({
      hierarchyIndex: filters.hierarchyIndex.value ?? compileHierarchy({}),
      allTypes: [...new Set([...filters.allTypes.value, ...usage.value.keys()])],
      usedTypes: [...usage.value.keys()],
      checkedTypes: [],
      counts: new Map(),
      frameCounts: new Map(),
      showEmpty: true,
      query: query.value ?? '',
      filterTypesByFrame: false,
      sort: 'a-z',
      collapsed: collapsed.value,
    }));
    const rows = computed(() => {
      const colorFor = styles.typeStyling.value.color;
      return model.value.rows.map((row) => {
        const ids = new Set();
        (model.value.subtree.get(row.type) ?? [row.type]).forEach((type) => {
          usage.value.get(type)?.forEach((id) => ids.add(id));
        });
        return {
          ...row,
          color: colorFor(row.type),
          direct: usage.value.get(row.type)?.size ?? 0,
          total: ids.size,
        };
      });
    });
    const deleteCount = computed(() => usage.value.get(deleting.value ?? '')?.size ?? 0);
    const childMessage = computed(() => {
      const type = deleting.value;
      const hierarchy = filters.typeHierarchy.value ?? {};
      if (type === null || !Object.values(hierarchy).includes(type)) return '';
      return hierarchy[type]
        ? `Children will move under "${hierarchy[type]}". Their types and tracks will be kept.`
        : 'Children will become top-level types. Their types and tracks will be kept.';
    });
    function requestDelete(type: string) {
      if (readOnly.value) return;
      deleting.value = type;
      disposition.value = null;
      deleteEmptyParents.value = false;
      deleteEmptyChildren.value = false;
      error.value = '';
    }
    function confirmDelete() {
      if (readOnly.value || deleting.value === null) return;
      if (deleteCount.value && !disposition.value) return;
      if (!filters.deleteTypeWithTracks(
        deleting.value,
        disposition.value ?? 'delete',
        deleteEmptyParents.value,
        deleteEmptyChildren.value,
      )) {
        error.value = 'The type could not be removed. Review its remaining tracks and try again.';
        return;
      }
      if (editing.value === deleting.value) editing.value = null;
      deleting.value = null;
    }
    return {
      filters,
      styles,
      readOnly,
      query,
      searching,
      parentTypes,
      toggleBranch,
      expandAll,
      collapseAll,
      deleteEmptyParents,
      deleteEmptyChildren,
      hasParent,
      hasChildren,
      editing,
      deleting,
      disposition,
      error,
      rows,
      deleteCount,
      childMessage,
      requestDelete,
      confirmDelete,
    };
  },
});
</script>

<template>
  <v-card>
    <v-card-title>
      Manage Types
      <v-spacer />
      <v-btn icon aria-label="Close type manager" @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </v-card-title>
    <v-card-text>
      <p>
        Edit a type to rename it or change its parent. Clear its parent to move it to the top level.
        Changes are applied immediately and saved with the dataset.
      </p>
      <p class="text-caption">
        Counts include all tracks across cameras, regardless of visibility or confidence filters.
        Direct counts match the stored type; branch counts include descendants, counting each track once.
      </p>
      <v-text-field v-model="query" label="Search types" prepend-inner-icon="mdi-magnify" clearable />
      <div v-if="parentTypes.size" class="d-flex align-center mb-2">
        <v-btn small text @click="expandAll">
          Expand All
        </v-btn>
        <v-btn small text :disabled="searching" @click="collapseAll">
          Collapse All
        </v-btn>
        <span v-if="searching" class="text-caption ml-2">
          Matching branches expand while searching.
        </span>
      </div>
      <v-simple-table fixed-header height="450">
        <thead>
          <tr>
            <th>Type / hierarchy</th>
            <th class="text-right">
              Direct tracks
            </th>
            <th class="text-right">
              Branch tracks
            </th>
            <th class="text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.type">
            <td :style="{ paddingLeft: `${16 + row.depth * 20}px` }">
              <div class="d-flex align-center type-row-label">
                <v-btn
                  v-if="row.hasChildren"
                  icon
                  small
                  :disabled="searching"
                  :aria-label="`${row.expanded ? 'Collapse' : 'Expand'} ${row.type}`"
                  :aria-expanded="String(row.expanded)"
                  @click="toggleBranch(row.type)"
                >
                  <v-icon small>
                    {{ row.expanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
                  </v-icon>
                </v-btn>
                <span v-else class="tree-leaf-spacer" aria-hidden="true" />
                <div
                  class="type-color-swatch mx-2"
                  :style="{ backgroundColor: row.color }"
                  :title="`Annotation color for ${row.type}`"
                  role="img"
                  :aria-label="`Annotation color for ${row.type}`"
                />
                {{ row.type }}
              </div>
            </td>
            <td class="text-right">
              {{ row.direct }}
            </td>
            <td class="text-right">
              {{ row.total }}
            </td>
            <td class="text-right text-no-wrap">
              <v-btn
                icon
                :disabled="readOnly"
                :aria-label="`Edit ${row.type}`"
                :title="`Edit ${row.type} or change parent`"
                @click="editing = row.type"
              >
                <v-icon small>
                  mdi-pencil
                </v-icon>
              </v-btn>
              <v-btn
                icon
                :disabled="readOnly"
                :aria-label="`Delete ${row.type}`"
                :title="`Delete ${row.type}`"
                @click="requestDelete(row.type)"
              >
                <v-icon small>
                  mdi-delete
                </v-icon>
              </v-btn>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="4" class="text-center">
              No types found.
            </td>
          </tr>
        </tbody>
      </v-simple-table>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn text @click="$emit('close')">
        Done
      </v-btn>
    </v-card-actions>
    <v-dialog :value="editing !== null" max-width="550" @input="!$event && (editing = null)">
      <TypeEditor
        v-if="editing !== null"
        :selected-type="editing"
        :filter-controls="filters"
        :style-manager="styles"
        @close="editing = null"
      />
    </v-dialog>
    <v-dialog :value="deleting !== null" max-width="600" @input="!$event && (deleting = null)">
      <v-card>
        <v-card-title>Delete type “{{ deleting }}”?</v-card-title>
        <v-card-text>
          <p v-if="childMessage">
            {{ childMessage }}
          </p>
          <v-checkbox
            v-if="hasParent"
            v-model="deleteEmptyParents"
            label="Delete empty parents too"
            hint="Also remove ancestors left with no child types or directly assigned tracks. Parents still in use are kept."
            persistent-hint
            class="mb-4"
          />
          <v-checkbox
            v-if="hasChildren"
            v-model="deleteEmptyChildren"
            label="Delete empty children too"
            hint="Also remove descendant types left with no child types or directly assigned tracks. Descendants still in use are kept."
            persistent-hint
            class="mb-4"
          />
          <template v-if="deleteCount">
            <p>
              {{ deleteCount }} track(s) contain this type directly, including hidden tracks.
              Choose what happens to them before removing the type.
            </p>
            <v-radio-group v-model="disposition">
              <v-radio
                v-if="deleting !== 'unknown'"
                label="Transfer this label to unknown; keep tracks and their other labels"
                value="unknown"
              />
              <v-radio
                label="Delete these entire tracks from every camera, including their annotations"
                value="delete"
                color="error"
              />
            </v-radio-group>
            <p v-if="deleting === 'unknown'">
              Tracks already labeled unknown cannot be transferred to unknown.
            </p>
          </template>
          <p v-else>
            No tracks use this type directly.
          </p>
          <v-alert v-if="error" type="error" dense>
            {{ error }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn text @click="deleting = null">
            Cancel
          </v-btn>
          <v-btn color="error" :disabled="readOnly || (deleteCount > 0 && !disposition)" @click="confirmDelete">
            {{ disposition === 'delete' && deleteCount ? 'Delete type and tracks' : 'Delete type' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style lang="scss" scoped>
.tree-leaf-spacer {
  display: inline-block;
  width: 36px;
  flex-shrink: 0;
}

.type-color-swatch {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.type-row-label {
  min-height: 36px;
}
</style>
