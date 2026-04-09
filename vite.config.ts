import vue from '@vitejs/plugin-vue';
import UnpluginCesium from 'unplugin-cesium/vite';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), UnpluginCesium()],
  define: {
    global: 'globalThis',
  },
  test: {
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15000,
  },
});
