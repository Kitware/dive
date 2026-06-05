# Vuetify Migration CSS Guide (V2 → V3)

This document catalogs theme tokens, component mapping, and custom CSS overrides for the DIVE Vue 3 / Vuetify 3 upgrade.

## Theme token mapping

| Vuetify 2 (DIVE) | Vuetify 3 (DIVE + GWC) | Source |
|------------------|------------------------|--------|
| `theme.themes.dark.accent` | `theme.themes.dark.colors.accent` | [`platform/web-girder/plugins/vuetify.ts`](../client/platform/web-girder/plugins/vuetify.ts) |
| `theme.themes.dark.accentBackground` | `theme.themes.dark.colors.accentBackground` | Brand + DIVE defaults |
| `theme.options.customProperties` | CSS variables via Vuetify 3 defaults | Removed explicit option |
| `$vuetify.theme.themes.dark.accent` | `useTheme().themes.value.dark.colors.accent` | Composables |
| `$vuetify.breakpoint.mdAndDown` | `useDisplay().mdAndDown` | ~10 views |
| `$vuetify.icons.fileNew` | `mdi-file-plus` | DiveGirderBrowser, breadcrumbs |

Brand overrides flow from Girder `brand_data.vuetify` via [`useBrand.ts`](../client/platform/web-girder/store/useBrand.ts) into `createDiveVuetify()`.

## Component mapping (high-traffic patterns)

| Vuetify 2 | Vuetify 3 |
|-----------|-----------|
| `v-tabs` + `v-tab-item` | `v-tabs` + `v-window` + `v-window-item` |
| `v-list-item-content` | Content directly in `v-list-item` |
| `v-list-item-icon` | `#prepend` slot with `v-icon` |
| `v-subheader` | `v-list-subheader` |
| `v-simple-table` | `v-table` |
| `activator="{ on, attrs }"` | `activator="{ props }"` + `v-bind="props"` |
| `v-btn text` | `v-btn variant="text"` |
| `v-btn outlined` | `v-btn variant="outlined"` |
| `v-btn depressed` | `v-btn variant="flat"` |
| `dense` on inputs | `density="compact"` |
| `:value` on `v-alert` | `model-value` |
| `.sync` modifier | `v-model:prop` |

## Custom CSS inventory

Files with Vuetify-dependent layout overrides:

| File | Notes |
|------|-------|
| [`Controls.vue`](../client/src/components/controls/Controls.vue) | Annotator toolbar layout, `::v-deep` selectors |
| [`Viewer.vue`](../client/dive-common/components/Viewer.vue) | Shell layout, sidebar sizing |
| [`DataSharedBreadCrumb.vue`](../client/platform/web-girder/views/DataSharedBreadCrumb.vue) | Breadcrumb icon spacing |
| [`Jobs.vue`](../client/platform/web-girder/views/Jobs.vue) | Code container dark background |
| [`MultiCamToolbar.vue`](../client/dive-common/components/MultiCamToolbar.vue) | Mode button sizing |
| [`RunPipelineMenu.vue`](../client/dive-common/components/RunPipelineMenu.vue) | Pipeline menu layout |
| [`Export.vue`](../client/platform/web-girder/views/Export.vue) | Export form layout |

## Layout-critical screens

Priority manual/visual verification:

1. Viewer annotator (Controls + sidebars)
2. Home / DataBrowser file browser
3. Jobs list + job widgets
4. Export dialog
5. Admin branding
6. NavigationBar + Login
7. Desktop Recent + Settings

## Girder Web Components

- Package: `@girder/components` branch `girder-5-websocket-configurable`
- Vite resolves `@/` imports inside GWC via `gwcInternalAlias` plugin
- Job UI (`GirderJobList`) vendored in [`GirderJobList.vue`](../client/platform/web-girder/components/GirderJobList.vue) (removed from GWC v4)
- Notifications: `NotificationBus` with `{ useWebSocket: true }` in [`plugins/girder.ts`](../client/platform/web-girder/plugins/girder.ts)

## Deferred: Vuetify 4

When GWC upgrades to Vuetify 4, run `vuetify-codemods` v3→v4 and update Playwright baselines for MD3 typography/elevation changes.
