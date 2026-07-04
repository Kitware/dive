/**
 * h5wasm's package exports map only defines an "import" condition for the
 * "./node" subpath, which the project's node10 moduleResolution cannot see.
 * The node build has the same API surface as the main entry, so re-export
 * its types (resolved through the package "types" field).
 */
declare module 'h5wasm/node' {
  import h5wasm from 'h5wasm';

  export * from 'h5wasm';
  export default h5wasm;
}
