<script setup lang="ts">
import {
  computed, onMounted, onBeforeUnmount, ref,
} from 'vue';
import type { AddonCatalog, AddonJob, ViameAddon } from 'platform/desktop/addons';
import NavigationBar from './NavigationBar.vue';

const catalog = ref<AddonCatalog | null>(null);
const error = ref('');
const loading = ref(false);
const starting = ref(false);
const search = ref('');
const busy = computed(() => starting.value || !!catalog.value?.job?.running);
const canInstall = computed(() => !!catalog.value?.installerAvailable && !catalog.value?.readOnly && !busy.value);
const headers = [
  { text: 'Add-on', value: 'name' }, { text: 'Description', value: 'description' },
  { text: 'Status', value: 'status' },
  { text: 'Actions', value: 'actions', sortable: false },
];
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    catalog.value = await window.diveDesktop.invoke<AddonCatalog>('desktop:addons-list');
    error.value = '';
  } catch (err) {
    catalog.value = null;
    error.value = (err as Error).message;
  } finally { loading.value = false; }
}
async function install(addon: ViameAddon, fromFile = false) {
  if (!canInstall.value) return;
  starting.value = true;
  error.value = '';
  try {
    let archive: string | undefined;
    if (fromFile) {
      const result = await window.diveDesktop.showOpenDialog({
        title: `Install ${addon.name} from ZIP`,
        properties: ['openFile'],
        filters: [{ name: 'Add-on archive', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePaths.length) return;
      [archive] = result.filePaths;
    }
    const job = await window.diveDesktop.invoke<AddonJob>('desktop:addons-install', {
      name: addon.name, force: addon.status === 'installed', archive,
    });
    if (catalog.value) catalog.value.job = job;
    await refresh();
  } catch (err) { error.value = (err as Error).message; } finally { starting.value = false; }
}
async function download(addon: ViameAddon) {
  try { await window.diveDesktop.invoke('open-link-in-browser', addon.url); } catch (err) { error.value = (err as Error).message; }
}
function needsBrowser(addon: ViameAddon) { return addon.url.includes('drive.google.com'); }
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  refresh();
  window.addEventListener('focus', refresh);
  timer = setInterval(() => { if (catalog.value?.job?.running) refresh(); }, 1500);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener('focus', refresh);
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-container fluid>
      <div class="d-flex align-center mb-3">
        <h1 class="text-h5">
          VIAME Add-Ons
        </h1>
        <v-spacer />
        <v-btn :loading="loading" @click="refresh">
          <v-icon left>
            mdi-refresh
          </v-icon>Refresh
        </v-btn>
      </div>
      <p>Install additional VIAME model packs. Status includes add-ons installed outside DIVE.</p>
      <p v-if="catalog" class="text-caption">
        Installation: {{ catalog.installDir }}
      </p>
      <v-alert v-if="error" type="error">
        {{ error }} <router-link :to="{ name: 'settings' }">
          Open Settings
        </router-link>
      </v-alert>
      <v-alert v-if="catalog && !catalog.installerAvailable" type="warning">
        This VIAME installation does not include the add-on installer. Update VIAME to enable installation here.
      </v-alert>
      <v-alert v-if="catalog && catalog.readOnly" type="info">
        Installation is disabled in read-only mode.
      </v-alert>
      <v-alert v-if="catalog && catalog.addons.some(a => a.status === 'unknown')" type="info">
        Some catalog entries do not provide an installation check file, so their status is unknown.
      </v-alert>
      <v-text-field v-model="search" label="Search add-ons" prepend-inner-icon="mdi-magnify" clearable />
      <v-data-table
        :headers="headers"
        :items="catalog ? catalog.addons : []"
        :search="search"
        :loading="loading"
        item-key="name"
        :items-per-page="25"
        no-data-text="No add-ons available in this VIAME installation's catalog."
      >
        <template #[`item.status`]="{ item }">
          <v-chip small :color="item.status === 'installed' ? 'success' : undefined">
            {{ item.status }}
          </v-chip>
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn v-if="!needsBrowser(item)" small class="ma-1" :disabled="!canInstall" @click="install(item)">
            {{ item.status === 'installed' ? 'Reinstall' : 'Install' }}
          </v-btn>
          <v-btn v-else small class="ma-1" @click="download(item)">
            Download in browser
          </v-btn>
          <v-btn small class="ma-1" :disabled="!canInstall" @click="install(item, true)">
            Install from ZIP
          </v-btn>
        </template>
      </v-data-table>
      <v-card v-if="catalog && catalog.job" class="mt-4" outlined>
        <v-card-title>{{ catalog.job.name }} — {{ catalog.job.running ? 'Installing' : (catalog.job.error ? 'Failed' : 'Finished') }}</v-card-title>
        <v-card-text>
          <v-progress-linear v-if="catalog.job.running" indeterminate class="mb-3" />
          <p v-if="catalog.job.installDir !== catalog.installDir">
            Installation: {{ catalog.job.installDir }}
          </p>
          <v-alert v-if="catalog.job.error" type="error">
            {{ catalog.job.error }}
          </v-alert>
          <pre class="addon-output">{{ catalog.job.log || 'Starting installer…' }}</pre>
        </v-card-text>
      </v-card>
    </v-container>
  </v-main>
</template>

<style scoped>
.addon-output { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow-y: auto; }
</style>
