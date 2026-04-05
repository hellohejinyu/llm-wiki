import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync, chmodSync, cpSync, existsSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  // Use entry mapping to preserve the 'bin/' subdirectory in 'dist'
  entry: {
    'bin/wiki': 'bin/wiki.ts',
  },
  format: ['esm'],
  outDir: 'dist',
  bundle: true,
  clean: true,
  shims: true,
  define: {
    __PKG_VERSION__: JSON.stringify(version),
  },
  async onSuccess() {
    // Correctly target the path within the 'dist' outDir
    const out = 'dist/bin/wiki.js';
    const content = readFileSync(out, 'utf8');
    if (!content.startsWith('#!')) {
      writeFileSync(out, '#!/usr/bin/env node\n' + content);
    }
    chmodSync(out, '755');

    // Copy schemas to dist/schemas so ../schemas/ works from dist/bin/wiki.js
    if (existsSync('src/schemas')) {
      cpSync('src/schemas', 'dist/schemas', { recursive: true, force: true });
      console.log('✔ Copied src/schemas → dist/schemas');
    }
  },
});
