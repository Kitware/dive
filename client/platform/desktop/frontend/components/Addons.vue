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
  {
    text: 'Status', value: 'status', align: 'center', class: 'addon-status-header',
  },
  {
    text: 'Actions', value: 'actions', sortable: false, align: 'center',
  },
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
        title: `Import local ZIP for ${addon.name}`,
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
      <p>Install additional VIAME model packs.</p>
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
        :items-per-page="-1"
        no-data-text="No add-ons available in this VIAME installation's catalog."
      >
        <template #[`item.status`]="{ item }">
          <v-chip small :color="item.status === 'installed' ? 'success' : undefined">
            {{ item.status }}
          </v-chip>
        </template>
        <template #[`item.actions`]="{ item }">
          <div class="addon-actions">
            <div>
              <v-btn v-if="!needsBrowser(item)" small block :disabled="!canInstall" @click="install(item)">
                Download and Install
              </v-btn>
              <v-btn v-else small block @click="download(item)">
                Download in browser
              </v-btn>
            </div>
            <div>
              <v-btn small block :disabled="!canInstall" @click="install(item, true)">
                Import Local ZIP
              </v-btn>
            </div>
          </div>
        </template>
      </v-data-table>
      <v-card v-if="catalog && catalog.job" class="mt-4" outlined>
        <v-card-title>{{ catalog.job.name }} — {{ catalog.job.running ? 'Installing' : (catalog.job.error ? 'Failed' : 'Finished') }}</v-card-title>
        <v-card-text>
          <v-alert v-if="catalog.job.running && catalog.job.phase === 'elevation'" type="info">
            Waiting for administrator permission. Approve the Windows permission prompt to continue.
          </v-alert>
          <div v-if="!catalog.job.localArchive" class="mb-3">
            <div>Download <span v-if="catalog.job.downloadProgress !== undefined">{{ Math.floor(catalog.job.downloadProgress) }}%</span></div>
            <v-progress-linear
              aria-label="Download progress"
              :value="catalog.job.downloadProgress || 0"
              :indeterminate="catalog.job.running && catalog.job.phase === 'download' && catalog.job.downloadProgress === undefined"
              :color="catalog.job.error ? 'error' : 'primary'"
            />
          </div>
          <div class="mb-3">
            <div>{{ catalog.job.phase === 'verify' ? 'Verifying archive' : 'Install' }} <span v-if="catalog.job.installProgress !== undefined">{{ Math.floor(catalog.job.installProgress) }}%</span></div>
            <v-progress-linear
              aria-label="Install progress"
              :value="catalog.job.installProgress || 0"
              :indeterminate="catalog.job.running && (catalog.job.phase === 'verify' || (catalog.job.phase === 'install' && catalog.job.installProgress === undefined))"
              :color="catalog.job.error ? 'error' : 'primary'"
            />
          </div>
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
/* Keep the label centered independently of the optional sorting arrow. */
::v-deep .addon-status-header { position: relative; }
::v-deep .addon-status-header .v-data-table-header__icon { position: absolute; top: 50%; margin-top: -9px; margin-left: 4px; }
.addon-actions { display: grid; grid-template-columns: minmax(210px, 1fr) minmax(170px, 1fr); gap: 12px; align-items: center; padding: 8px 0; }
.addon-output { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow-y: auto; }
</style>
