import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
    }),
  ],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      $testing: fileURLToPath(new URL('./src/testing', import.meta.url)),
      $app: fileURLToPath(new URL('./.svelte-kit/runtime/app', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,js}'],
  },
});
