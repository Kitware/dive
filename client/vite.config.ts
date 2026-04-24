import { resolve } from 'node:path';

import { createSharedConfig } from './vite.shared';

export default createSharedConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
