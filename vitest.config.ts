import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Тесты проверяют чистую логику ядра и провайдеров — без браузера и без сети.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(process.cwd(), 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
