# Vue 3 Upgrade — PR Summary

## Summary

This branch migrates the DIVE client from **Vue 2.7 / Vuetify 2 / vue-router 3** to **Vue 3 / Vuetify 3 / vue-router 4**, and adopts the Vue 3 branch of **Girder Web Components** (`girder-5-websocket-configurable`).

Key changes:

- **Core stack:** `createApp()` bootstrapping for web-girder and desktop, `@vitejs/plugin-vue`, updated TypeScript shims
- **Vuetify 3:** Shared `createDiveVuetify()` setup, theme/palette utilities, and v2-compat SCSS for layout parity
- **Girder Web Components:** Plugin-based initialization, `patch-package` fixes, local job list components, and upload/progress mixins ported for Vue 3
- **Component migration:** `.sync` → `v-model:prop`, Vuetify 3 API updates across ~130 files (dive-common, src, web-girder, desktop)
- **Plugins & utilities:** Vue 3 plugin API for `prompt-service` and `v-mousetrap`, `mergeActivatorProps` helper, router/store composable updates
- **Build:** `postinstall` runs `patch-package`; Docker client build copies `client/.npmrc`

Also includes merged work from `main`: dataset info panel, Girder 5.0.10 / Traefik upgrades, and axios bump.

## Test plan

### Verified / in progress

- [ ] App boots (web-girder)
- [ ] App boots (desktop)
- [ ] Basic annotation viewer navigation and editing
- [ ] Vuetify UI renders correctly (dialogs, menus, tabs, data tables)

### Still needs testing

- [ ] **WebSocket communication** — Girder 5 notification bus (`useWebSocket: true`); confirm proxy forwards `Upgrade` header and job/upload progress updates arrive in real time
- [ ] **Upload annotations** — Girder upload flow, multi-file upload, progress reporting
- [ ] **Download / export annotations** — Export dialog, VIAME/COCO/etc. formats
- [ ] **Read-only mode** — Shared datasets, permission-restricted views; ensure editing controls are disabled and no save prompts appear
- [ ] **Desktop app** — Full review of Electron build: import, export, jobs, settings, recent datasets, pipeline menus

### Additional areas to spot-check

- [ ] Login / authentication and session persistence
- [ ] Jobs list (local replacement components) — filter, cancel, progress
- [ ] Data browser, folder navigation, clone/share flows
- [ ] Admin pages (jobs, recents)
- [ ] Keyboard shortcuts (`v-mousetrap`)
- [ ] Autosave prompt and revision history
- [ ] Multi-cam toolbar and import dialogs
- [ ] Image/video/large-image annotators and media controls

## Known risks / follow-ups

- `@girder/components` is pinned to a GitHub branch and patched via `patch-package` — upstream fixes may reduce patch surface over time
- Vuetify 2 → 3 template/prop changes are broad; edge-case UI regressions are likely until manual QA passes
- Desktop platform received fewer hands-on passes than web-girder during migration
- UILayer GeoJS widget mounting and some legacy mixin patterns may need further composable refactors

## Related docs

- [`client/VUE3-UPGRADE.md`](./VUE3-UPGRADE.md) — phased migration plan and dependency notes
