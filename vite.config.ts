import process from 'node:process';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import UnpluginCesium from 'unplugin-cesium/vite';
import { defineConfig } from 'vitest/config';
import { resolvePublicBase } from './src/build/public-path';

// https://vite.dev/config/
const base = resolvePublicBase({
  base: process.env.VITE_BASE,
  githubPages: process.env.GITHUB_PAGES === 'true',
});

export default defineConfig({
  base,
  plugins: [vue(), UnpluginCesium({ base })],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('src', import.meta.url)),
    },
  },
});
