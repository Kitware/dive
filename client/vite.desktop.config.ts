import { resolve } from 'node:path';
import { createSharedConfig } from './vite.shared';

export default createSharedConfig({
  build: {
    outDir: 'dist_desktop',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'desktop.html'),
    },
  },
  base: './',
});
