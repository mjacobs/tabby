import { fileURLToPath, URL } from 'node:url';

import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      // The review page and side panel are opened dynamically (chrome.tabs.create
      // / chrome.sidePanel.setOptions), so they aren't referenced by the manifest
      // and must be declared as explicit inputs.
      input: {
        review: fileURLToPath(new URL('./src/review/review.html', import.meta.url)),
        sidepanel: fileURLToPath(new URL('./src/sidepanel/sidepanel.html', import.meta.url)),
      },
    },
  },
  // crxjs needs a stable HMR port for the service worker / content scripts.
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
