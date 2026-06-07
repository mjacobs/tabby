import { defineManifest } from '@crxjs/vite-plugin';

import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Tabby',
  version: pkg.version,
  description: pkg.description,
  // Clicking the toolbar icon runs the cleanup pipeline (handled in background).
  action: {
    default_title: 'Tabby: clean up tabs',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  options_page: 'src/options/options.html',
  permissions: ['tabs', 'tabGroups', 'storage', 'sessions'],
  optional_permissions: ['sidePanel'],
  web_accessible_resources: [
    {
      resources: ['src/review/review.html'],
      matches: ['<all_urls>'],
    },
  ],
  commands: {
    'run-cleanup': {
      suggested_key: {
        default: 'Ctrl+Shift+K',
        mac: 'Command+Shift+K',
      },
      description: 'Consolidate, dedup, sort, and review tabs',
    },
  },
});
