/**
 * esbuild inject shim for the CJS divecli bundle: rewrites import.meta.url
 * (used by ESM-only dependencies) to the equivalent file URL. Paired with
 * --define:import.meta.url=import_meta_url in the build:cli script.
 */
/* eslint-disable no-var, vars-on-top, camelcase, global-require,
   import/prefer-default-export, import/no-mutable-exports */
export var import_meta_url = require('url').pathToFileURL(__filename).href;
