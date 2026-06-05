#!/usr/bin/env node
/** Second-pass cleanup for Vuetify 2→3 migration */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIRS = ['src', 'dive-common', 'platform'];

function walkDir(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkDir(full, files);
    } else if (entry.name.endsWith('.vue')) {
      files.push(full);
    }
  }
  return files;
}

function fixBrokenImports(content) {
  return content.replace(
    /import \{\nimport \{ useDisplay \} from 'vuetify';\nimport \{ defineComponent \} from 'vue';\n([\s\S]*?)\} from 'vue';/g,
    (match, imports) => `import {\n${imports}} from 'vue';\nimport { useDisplay } from 'vuetify';`,
  );
}

function cleanupActivators(content) {
  let r = content;
  // Common leftover bindings after slot migration
  r = r.replace(/\bv-bind="attrs"\s*\n(\s*)v-on="on"/g, 'v-bind="props"');
  r = r.replace(/\bv-on="on"\s*\n(\s*)v-bind="attrs"/g, 'v-bind="props"');
  r = r.replace(/\bv-bind="attrs"\s+v-on="on"/g, 'v-bind="props"');
  r = r.replace(/\bv-on="on"\s+v-on="attrs"/g, 'v-bind="props"');
  r = r.replace(/\bv-bind="attrs"\b/g, 'v-bind="props"');
  r = r.replace(/\bv-on="on"\b/g, 'v-bind="props"');
  r = r.replace(/\bv-on="menuOn"\b/g, 'v-bind="menuProps"');
  r = r.replace(/\bv-on="tooltipOn"\b/g, 'v-bind="tooltipProps"');
  // Fix wrong order slot destructure
  r = r.replace(/#activator="\{\s*attrs,\s*on\s*\}"/g, '#activator="{ props: dialogProps }"');
  r = r.replace(/#activator="\{\s*on:\s*menuOn,\s*attrs\s*\}"/g, '#activator="{ props: menuProps }"');
  r = r.replace(/#activator="\{\s*bind,\s*on\s*\}"/g, '#activator="{ props }"');
  r = r.replace(/\bv-bind="bind"\b/g, 'v-bind="props"');
  // Nested Clone.vue pattern
  r = r.replace(
    /#activator="\{\s*on:\s*ton,\s*attrs:\s*tattrs\s*\}"/g,
    '#activator="{ props: tooltipProps }"',
  );
  r = r.replace(
    /v-bind="\{\s*\.\.\.tattrs,\s*\.\.\.buttonOptions\s*\}"/g,
    'v-bind="{ ...tooltipProps, ...buttonOptions }"',
  );
  r = r.replace(
    /v-on="\{\s*\.\.\.ton,\s*click\s*\}"/g,
    'v-bind="tooltipProps" @click="click"',
  );
  r = r.replace(
    /v-on="\{\s*\.\.\.menuOn,\s*\.\.\.tooltipOn\s*\}"/g,
    'v-bind="{ ...menuProps, ...tooltipProps }"',
  );
  // Viewer.vue onIconProps typo fix - slot was renamed from on: onIcon
  r = r.replace(/#activator="\{\s*props:\s*onIconProps\s*\}"/g, '#activator="{ props: iconProps }"');
  r = r.replace(/\bonIconProps\b/g, 'iconProps');
  return r;
}

function ensureMdAndDown(content) {
  if (!/\bmdAndDown\b/.test(content)) return content;
  if (/useDisplay\(\)/.test(content)) return content;

  let r = content;
  if (!/import \{ useDisplay \} from 'vuetify';/.test(r)) {
    r = r.replace(/(<script[^>]*>\n)/, "$1import { useDisplay } from 'vuetify';\n");
  }
  r = r.replace(/setup\(([^)]*)\)\s*\{/, 'setup($1) {\n    const { mdAndDown } = useDisplay();');
  r = r.replace(/return \{\n/, 'return {\n      mdAndDown,\n');
  return r;
}

const changed = [];
for (const dir of DIRS) {
  for (const file of walkDir(path.join(ROOT, dir))) {
    const orig = fs.readFileSync(file, 'utf8');
    let next = orig;
    next = fixBrokenImports(next);
    next = cleanupActivators(next);
    next = ensureMdAndDown(next);
    if (next !== orig) {
      fs.writeFileSync(file, next);
      changed.push(path.relative(ROOT, file));
    }
  }
}
console.log(JSON.stringify({ changedCount: changed.length, changedFiles: changed.sort() }, null, 2));
