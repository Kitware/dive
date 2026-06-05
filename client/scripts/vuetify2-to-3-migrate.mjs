#!/usr/bin/env node
/**
 * Vuetify 2 → 3 template/script migrations for dive client.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIRS = ['src', 'dive-common', 'platform'];

const VUETIFY_FORM_COMPONENTS = [
  'v-text-field',
  'v-select',
  'v-combobox',
  'v-autocomplete',
  'v-textarea',
  'v-file-input',
  'v-checkbox',
  'v-switch',
  'v-radio-group',
  'v-slider',
  'v-range-slider',
  'v-list',
  'v-tabs',
  'v-toolbar',
  'v-card',
  'v-chip',
  'v-btn',
];

const changedFiles = new Set();
const unfixed = [];

function walkDir(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkDir(full, files);
    } else if (/\.(vue|ts)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function getFiles() {
  const files = [];
  for (const dir of DIRS) {
    walkDir(path.join(ROOT, dir), files);
  }
  return files;
}

function writeIfChanged(file, content, original) {
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    changedFiles.add(path.relative(ROOT, file));
    return true;
  }
  return false;
}

function migrateActivatorSlots(content) {
  let result = content;

  // v-slot:activator → #activator normalization handled by both patterns
  const activatorPatterns = [
    // { on, attrs }
    /#activator="\{\s*on,\s*attrs\s*\}"/g,
    /v-slot:activator="\{\s*on,\s*attrs\s*\}"/g,
    // { on: alias, attrs: alias }
    /#activator="\{\s*on:\s*(\w+),\s*attrs:\s*(\w+)\s*\}"/g,
    /v-slot:activator="\{\s*on:\s*(\w+),\s*attrs:\s*(\w+)\s*\}"/g,
    // { on: alias } only
    /#activator="\{\s*on:\s*(\w+)\s*\}"/g,
    /v-slot:activator="\{\s*on:\s*(\w+)\s*\}"/g,
    // { on } only
    /#activator="\{\s*on\s*\}"/g,
    /v-slot:activator="\{\s*on\s*\}"/g,
  ];

  // Standard { on, attrs }
  result = result.replace(/#activator="\{\s*on,\s*attrs\s*\}"/g, '#activator="{ props }"');
  result = result.replace(/v-slot:activator="\{\s*on,\s*attrs\s*\}"/g, '#activator="{ props }"');

  // Renamed destructuring with both on and attrs
  result = result.replace(
    /#activator="\{\s*on:\s*(\w+),\s*attrs:\s*(\w+)\s*\}"/g,
    (_, onName) => {
      const base = onName.replace(/On$/, '') || 'slot';
      const propsName = `${base}Props`;
      return `#activator="{ props: ${propsName} }"`;
    },
  );
  result = result.replace(
    /v-slot:activator="\{\s*on:\s*(\w+),\s*attrs:\s*(\w+)\s*\}"/g,
    (_, onName) => {
      const base = onName.replace(/On$/, '') || 'slot';
      const propsName = `${base}Props`;
      return `#activator="{ props: ${propsName} }"`;
    },
  );

  // Renamed on only
  result = result.replace(
    /#activator="\{\s*on:\s*(\w+)\s*\}"/g,
    (_, onName) => {
      const base = onName.replace(/On$/, '') || 'slot';
      return `#activator="{ props: ${base}Props }"`;
    },
  );
  result = result.replace(
    /v-slot:activator="\{\s*on:\s*(\w+)\s*\}"/g,
    (_, onName) => {
      const base = onName.replace(/On$/, '') || 'slot';
      return `#activator="{ props: ${base}Props }"`;
    },
  );

  // Plain { on }
  result = result.replace(/#activator="\{\s*on\s*\}"/g, '#activator="{ props }"');
  result = result.replace(/v-slot:activator="\{\s*on\s*\}"/g, '#activator="{ props }"');

  // Replace v-bind/v-on pairs with v-bind="props" or aliased props
  // menuOn + menuAttrs → menuProps (after slot rename)
  result = result.replace(
    /v-bind="(\w+Attrs)"\s*\n(\s*)v-on="(\w+On)"/g,
    (match, attrsName, indent, onName) => {
      const base = onName.replace(/On$/, '');
      if (attrsName === `${base}Attrs` || attrsName.replace(/Attrs$/, '') === base.replace(/On$/, '')) {
        return `v-bind="${base}Props"`;
      }
      return match;
    },
  );
  result = result.replace(
    /v-on="(\w+On)"\s*\n(\s*)v-bind="(\w+Attrs)"/g,
    (match, onName, indent, attrsName) => {
      const base = onName.replace(/On$/, '');
      if (attrsName === `${base}Attrs`) {
        return `v-bind="${base}Props"`;
      }
      return match;
    },
  );
  result = result.replace(/v-bind="attrs"\s*\n(\s*)v-on="on"/g, 'v-bind="props"');
  result = result.replace(/v-on="on"\s*\n(\s*)v-bind="attrs"/g, 'v-bind="props"');
  result = result.replace(/v-bind="attrs"\s+v-on="on"/g, 'v-bind="props"');
  result = result.replace(/v-on="on"\s+v-bind="attrs"/g, 'v-bind="props"');
  result = result.replace(/\bv-bind="attrs"\b/g, 'v-bind="props"');
  result = result.replace(/\bv-on="on"\b/g, 'v-bind="props"');

  // Aliased single v-on after slot rename
  result = result.replace(/\bv-on="(\w+On)"\b/g, (match, onName) => {
    const base = onName.replace(/On$/, '');
    return `v-bind="${base}Props"`;
  });
  result = result.replace(/\bv-bind="(\w+Attrs)"\b/g, (match, attrsName) => {
    const base = attrsName.replace(/Attrs$/, '');
    return `v-bind="${base}Props"`;
  });

  return result;
}

function migrateTabs(content) {
  return content
    .replace(/<v-tabs-items\b/g, '<v-window')
    .replace(/<\/v-tabs-items>/g, '</v-window>')
    .replace(/<v-tab-item\b/g, '<v-window-item')
    .replace(/<\/v-tab-item>/g, '</v-window-item>');
}

function migrateListItemContent(content) {
  return content
    .replace(/<v-list-item-content>\s*/g, '')
    .replace(/\s*<\/v-list-item-content>/g, '');
}

function migrateListItemIcon(content) {
  return content.replace(
    /<v-list-item-icon>\s*([\s\S]*?)\s*<\/v-list-item-icon>/g,
    '<template #prepend>\n$1\n</template>',
  );
}

function migrateSubheader(content) {
  return content
    .replace(/<v-subheader\b/g, '<v-list-subheader')
    .replace(/<\/v-subheader>/g, '</v-list-subheader>');
}

function migrateSimpleTable(content) {
  return content
    .replace(/<v-simple-table\b/g, '<v-table')
    .replace(/<\/v-simple-table>/g, '</v-table>');
}

function migrateBtnVariants(content) {
  // Only transform boolean attributes on v-btn opening tags (not :outlined bindings)
  return content.replace(/<v-btn([^>]*?)>/g, (match, attrs) => {
    let a = attrs;
    if (/\bvariant=/.test(a)) return match;
    if (/\btext\b(?!=)/.test(a) && !/:text=/.test(a)) {
      a = a.replace(/\btext\b/g, 'variant="text"');
    }
    if (/\boutlined\b(?!=)/.test(a) && !/:outlined=/.test(a)) {
      a = a.replace(/\boutlined\b/g, 'variant="outlined"');
    }
    if (/\bdepressed\b(?!=)/.test(a) && !/:depressed=/.test(a)) {
      a = a.replace(/\bdepressed\b/g, 'variant="flat"');
    }
    return `<v-btn${a}>`;
  });
}

function migrateDense(content) {
  let result = content;
  for (const tag of VUETIFY_FORM_COMPONENTS) {
    const re = new RegExp(`(<${tag.replace('-', '\\-')}[^>]*?)\\bdense\\b`, 'g');
    result = result.replace(re, (match, prefix) => {
      if (/density=/.test(prefix)) return match;
      return `${prefix}density="compact"`;
    });
  }
  return result;
}

function migrateVueExtend(content) {
  let result = content;
  if (!/Vue\.extend/.test(result)) return result;

  result = result.replace(
    /import Vue,\s*\{([^}]+)\}\s*from\s*['"]vue['"];/g,
    'import { defineComponent,$1 } from \'vue\';',
  );
  result = result.replace(
    /import Vue from ['"]vue['"];\n/g,
    'import { defineComponent } from \'vue\';\n',
  );
  result = result.replace(/export default Vue\.extend\(\{/g, 'export default defineComponent({');
  return result;
}

function migrateVueSetDelete(content, file) {
  if (!/Vue\.(set|delete)/.test(content)) return content;

  let result = content;

  // Vue.set(obj, key, value) → obj[key] = value
  result = result.replace(
    /Vue\.set\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*([\s\S]*?)\s*\);/g,
    '$1[$2] = $3;',
  );

  // Vue.delete(obj, key) → delete obj[key]
  result = result.replace(
    /Vue\.delete\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\);/g,
    'delete $1[$2];',
  );

  // Remove Vue from import if only used for set/delete
  if (/import Vue,\s*\{/.test(result)) {
    result = result.replace(/import Vue,\s*\{/g, 'import {');
  } else if (/import Vue from ['"]vue['"];\n/.test(result) && !/Vue\./.test(result)) {
    result = result.replace(/import Vue from ['"]vue['"];\n/, '');
  }

  return result;
}

function injectUseDisplay(content, file) {
  if (!/\$vuetify\.breakpoint/.test(content)) return content;

  const isVue = file.endsWith('.vue');
  if (!isVue) return content;

  let result = content;
  const breakpointProps = [...new Set(
    [...result.matchAll(/\$vuetify\.breakpoint\.(\w+)/g)].map((m) => m[1]),
  )];

  if (breakpointProps.length === 0) return result;

  // Replace template usages
  for (const prop of breakpointProps) {
    result = result.replace(
      new RegExp(`\\$vuetify\\.breakpoint\\.${prop}`, 'g'),
      prop,
    );
  }

  const displayImport = "import { useDisplay } from 'vuetify';";
  const displayDestructuring = `const { ${breakpointProps.join(', ')} } = useDisplay();`;

  if (/<script setup/.test(result)) {
    if (!result.includes(displayImport)) {
      result = result.replace(
        /(<script setup[^>]*>\n)/,
        `$1${displayImport}\n${displayDestructuring}\n`,
      );
    } else if (!result.includes('useDisplay()')) {
      result = result.replace(
        /(import \{ useDisplay \} from 'vuetify';?\n)/,
        `$1${displayDestructuring}\n`,
      );
    }
    return result;
  }

  // defineComponent with setup()
  if (/setup\s*\(\s*\)\s*\{/.test(result)) {
    if (!result.includes(displayImport)) {
      result = result.replace(
        /(import .+\n)(?=export default defineComponent|export default \{)/,
        `$1${displayImport}\n`,
      );
    }
    if (!result.includes('useDisplay()')) {
      result = result.replace(
        /setup\s*\(\s*\)\s*\{\n/,
        `setup() {\n    ${displayDestructuring}\n`,
      );
      // Add to return if return block exists
      result = result.replace(
        /return\s*\{\n/,
        `return {\n      ${breakpointProps.join(',\n      ')},\n`,
      );
    }
    return result;
  }

  // Options API without setup - add setup block
  if (!result.includes(displayImport)) {
    result = result.replace(
      /(<script[^>]*>\n)(import .+\n)?/,
      (m, scriptTag, imports) => {
        const imp = imports || '';
        if (imp.includes("from 'vue'") || imp.includes('from "vue"')) {
          return `${scriptTag}${imp.replace(
            /from ['"]vue['"];/,
            (vueImp) => vueImp.replace(
              /\{\s*/,
              '{ useDisplay as _useDisplayUnused, ',
            ).replace(/, useDisplay as _useDisplayUnused, /, '{ '),
          )}${displayImport}\n`;
        }
        return `${scriptTag}${imp}${displayImport}\nimport { defineComponent } from 'vue';\n`;
      },
    );
  }

  // Add setup to export default defineComponent({ or export default {
  if (/export default defineComponent\(\{/.test(result) || /export default \{/.test(result)) {
    if (!/setup\s*\(\)/.test(result)) {
      result = result.replace(
        /(export default (?:defineComponent\(\{|)\{)\n(\s*name:)/,
        `$1\n  setup() {\n    ${displayDestructuring}\n    return { ${breakpointProps.join(', ')} };\n  },\n$2`,
      );
    }
  }

  if (result.includes('$vuetify.breakpoint')) {
    unfixed.push({ file: path.relative(ROOT, file), pattern: '$vuetify.breakpoint (manual setup needed)' });
  }

  return result;
}

function migrateVueFile(file, content) {
  let result = content;
  result = migrateActivatorSlots(result);
  result = migrateTabs(result);
  result = migrateListItemContent(result);
  result = migrateListItemIcon(result);
  result = migrateSubheader(result);
  result = migrateSimpleTable(result);
  result = migrateBtnVariants(result);
  result = migrateDense(result);
  result = migrateVueExtend(result);
  result = injectUseDisplay(result, file);
  return result;
}

function migrateTsFile(file, content) {
  let result = content;
  result = migrateVueSetDelete(result, file);
  result = migrateVueExtend(result);
  return result;
}

function main() {
  const files = getFiles();
  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    const migrated = file.endsWith('.vue')
      ? migrateVueFile(file, original)
      : migrateTsFile(file, original);
    writeIfChanged(file, migrated, original);
  }

  console.log(JSON.stringify({
    changedCount: changedFiles.size,
    changedFiles: [...changedFiles].sort(),
    unfixed,
  }, null, 2));
}

main();
