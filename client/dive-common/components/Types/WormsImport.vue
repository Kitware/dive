<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, ref,
} from 'vue';
import {
  WormsClient, WormsRecord, WORMS_PAGE_SIZE, wormsLink,
} from '../worms';

export default defineComponent({
  name: 'WormsImport',
  props: { disabled: { type: Boolean, default: false } },
  setup(props, { emit }) {
    const client = new WormsClient();
    const query = ref('');
    const searchedQuery = ref('');
    const results = ref<WormsRecord[]>([]);
    const selected = ref<WormsRecord[]>([]);
    const parents = ref<WormsRecord[]>([]);
    const offset = ref(1);
    const includeParents = ref(true);
    const busy = ref(false);
    const preparing = ref(false);
    const completed = ref(0);
    const searched = ref(false);
    const error = ref('');
    const currentParent = computed(() => parents.value[parents.value.length - 1]);
    const selectedIds = computed(() => new Set(selected.value.map((item) => item.AphiaID)));
    let controller: AbortController | undefined;
    let version = 0;
    function cancel() {
      version += 1;
      controller?.abort();
      busy.value = false;
      preparing.value = false;
    }
    onBeforeUnmount(cancel);
    function invalidate() {
      emit('prepared', null);
      error.value = '';
    }
    async function loadPage(nextOffset: number) {
      cancel();
      const requestVersion = version;
      controller = new AbortController();
      busy.value = true;
      error.value = '';
      results.value = [];
      searched.value = true;
      offset.value = nextOffset;
      try {
        const page = currentParent.value
          ? await client.children(currentParent.value.AphiaID, nextOffset, controller.signal)
          : await client.search(searchedQuery.value, nextOffset, controller.signal);
        if (version === requestVersion) results.value = page;
      } catch (err) {
        if (version === requestVersion) error.value = err instanceof Error ? err.message : 'Unable to search WoRMS.';
      } finally {
        if (version === requestVersion) busy.value = false;
      }
    }
    function search() {
      parents.value = [];
      searchedQuery.value = query.value;
      return loadPage(1);
    }
    function browse(taxon: WormsRecord) {
      parents.value = [...parents.value, taxon];
      return loadPage(1);
    }
    function back() {
      parents.value = parents.value.slice(0, -1);
      return loadPage(1);
    }
    function toggle(taxon: WormsRecord) {
      invalidate();
      selected.value = selectedIds.value.has(taxon.AphiaID)
        ? selected.value.filter((item) => item.AphiaID !== taxon.AphiaID)
        : [...selected.value, taxon];
    }
    function selectPage() {
      invalidate();
      selected.value = [...selected.value, ...results.value.filter((item) => (
        !selectedIds.value.has(item.AphiaID) && (item.status === 'accepted' || item.valid_AphiaID)
      ))];
    }
    function clearSelection() {
      invalidate();
      selected.value = [];
    }
    async function prepare() {
      if (props.disabled || !selected.value.length) return;
      cancel();
      invalidate();
      const requestVersion = version;
      controller = new AbortController();
      busy.value = true;
      preparing.value = true;
      completed.value = 0;
      try {
        const incoming = await client.prepare(
          selected.value,
          includeParents.value,
          controller.signal,
          (count) => { if (version === requestVersion) completed.value = count; },
        );
        if (version === requestVersion) emit('prepared', incoming);
      } catch (err) {
        if (version === requestVersion) error.value = err instanceof Error ? err.message : 'Unable to prepare WoRMS categories.';
      } finally {
        if (version === requestVersion) {
          busy.value = false;
          preparing.value = false;
        }
      }
    }
    return {
      query,
      results,
      selected,
      selectedIds,
      includeParents,
      busy,
      preparing,
      completed,
      searched,
      error,
      currentParent,
      offset,
      pageSize: WORMS_PAGE_SIZE,
      search,
      browse,
      back,
      loadPage,
      toggle,
      selectPage,
      clearSelection,
      prepare,
      invalidate,
      cancel,
      wormsLink,
    };
  },
});
</script>

<template>
  <div>
    <p>Search marine scientific names in the World Register of Marine Species (WoRMS).</p>
    <v-text-field
      v-model="query"
      label="Scientific name (species, genus, or family)"
      :disabled="busy"
      @keydown.enter.prevent="search"
    />
    <v-btn small :disabled="busy || query.trim().length < 2" @click="search">
      Search
    </v-btn>
    <div v-if="currentParent" class="mt-3">
      <v-btn small text :disabled="busy" @click="back">
        Back
      </v-btn>
      Children of {{ currentParent.scientificname }}
    </div>
    <v-alert v-if="error" type="error" dense class="mt-3">
      {{ error }}
      <v-btn v-if="!busy" small text @click="loadPage(offset)">
        Retry search
      </v-btn>
    </v-alert>
    <v-progress-linear v-if="busy" indeterminate class="mt-3" />
    <div v-if="preparing" class="mt-2">
      Preparing {{ completed }} / {{ selected.length }} selected taxa…
    </div>
    <v-btn v-if="busy" small text @click="cancel">
      Cancel request
    </v-btn>
    <div v-if="searched && !busy && !error && !results.length" class="mt-3">
      No matching taxa on this page.
    </div>
    <div v-if="results.length" class="worms-results mt-3">
      <div v-for="taxon in results" :key="taxon.AphiaID" class="worms-row">
        <v-checkbox
          :input-value="selectedIds.has(taxon.AphiaID)"
          :disabled="busy || (taxon.status !== 'accepted' && !taxon.valid_AphiaID)"
          :label="taxon.scientificname"
          dense
          hide-details
          class="mt-0"
          @change="toggle(taxon)"
        />
        <div class="ml-8 text-caption">
          {{ taxon.rank }} · {{ taxon.authority }} · {{ taxon.status }}
          <span v-if="taxon.valid_name && taxon.valid_name !== taxon.scientificname">
            → {{ taxon.valid_name }}
          </span>
          <a :href="wormsLink(taxon.AphiaID)" target="_blank" rel="noopener noreferrer">WoRMS {{ taxon.AphiaID }}</a>
          <v-btn small text :disabled="busy" @click="browse(taxon)">
            Browse children
          </v-btn>
        </div>
      </div>
    </div>
    <div v-if="searched" class="my-3">
      <v-btn small :disabled="busy || offset === 1" @click="loadPage(offset - pageSize)">
        Previous
      </v-btn>
      <span class="mx-2">Page {{ Math.ceil(offset / pageSize) }}</span>
      <v-btn small :disabled="busy || results.length < pageSize" @click="loadPage(offset + pageSize)">
        Next
      </v-btn>
      <v-btn small text :disabled="busy || !results.length" @click="selectPage">
        Select page
      </v-btn>
    </div>
    <p class="mt-3">
      {{ selected.length }} taxa selected across pages.
      <v-btn small text :disabled="busy || !selected.length" @click="clearSelection">
        Clear selection
      </v-btn>
    </p>
    <div v-if="selected.length" class="worms-selection">
      <v-chip v-for="taxon in selected.slice(0, 100)" :key="taxon.AphiaID" small close :disabled="busy" @click:close="toggle(taxon)">
        {{ taxon.scientificname }}
      </v-chip>
      <span v-if="selected.length > 100">Showing the first 100 selected taxa.</span>
    </div>
    <v-checkbox v-model="includeParents" :disabled="busy" label="Include taxonomic parent categories" @change="invalidate" />
    <v-btn small color="primary" :disabled="disabled || busy || !selected.length" @click="prepare">
      Add
    </v-btn>
    <p class="mt-3 text-caption">
      Names and classifications supplied by <a href="https://www.marinespecies.org" target="_blank" rel="noopener noreferrer">WoRMS</a>. Internet access is required. Synonyms are imported using their accepted scientific names.
    </p>
  </div>
</template>

<style scoped>
.worms-results { max-height: 280px; overflow-y: auto; }
.worms-selection { max-height: 100px; overflow-y: auto; }
.worms-row { padding: 8px 0; border-bottom: 1px solid #8884; }
</style>
