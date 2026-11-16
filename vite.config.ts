import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, UserConfig } from 'vite';

// Собираем расширение: отдельные самодостаточные бандлы для content script и
// service worker. MV3 требует, чтобы в манифесте лежали реальные файлы и не было
// удалённого кода.
const root = process.cwd();
const outDir = resolve(root, 'dist');

/**
 * Копирование манифеста в `dist`.
 *
 * Манифест не участвует в бандле, но обязан лежать рядом с ним.
 */
function copyManifest(): Plugin {
  return {
    name: 'kataoke-copy-manifest',
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      copyFileSync(resolve(root, 'manifest.json'), resolve(outDir, 'manifest.json'));
    },
  };
}

/**
 * Проверка, что файлы расширения остались классическими скриптами.
 *
 * MV3 грузит content script как обычный скрипт: наличие `import` — это
 * расширение, которое не запустится, причём без внятной ошибки. Лучше уронить
 * сборку, чем отдать такой файл.
 */
function assertClassicScripts(): Plugin {
  return {
    name: 'kataoke-assert-classic-scripts',
    closeBundle() {
      for (const file of ['content.js', 'page-agent.js']) {
        const code = readFileSync(resolve(outDir, file), 'utf8');
        if (/^\s*(import|export)\s/m.test(code)) {
          throw new Error(
            `${file} содержит import/export: скрипты расширения в MV3 должны быть классическими`,
          );
        }
      }
    },
  };
}

/** Точки входа сборки: имя файла в `dist` и исходник. */
const ENTRY_POINTS: Record<string, { name: string; source: string }> = {
  content: { name: 'content', source: 'src/content/index.ts' },
  background: { name: 'background', source: 'src/background/index.ts' },
  'page-agent': { name: 'page-agent', source: 'src/adapters/yandex-music/page-agent.ts' },
};

/**
 * Два независимых прогона сборки: `--mode content` и `--mode background`
 * (плюс `--mode page-agent`).
 *
 * Собирать несколько входов за один прогон нельзя: Rollup выносит общий код в
 * `chunks/`, а content script в MV3 — **классический скрипт**, он не умеет
 * `import` и молча не запускается. Отдельный прогон инлайнит весь код в файл.
 */
export default function config({ mode }: { mode: string }): UserConfig {
  const entry = ENTRY_POINTS[mode];
  if (!entry) throw new Error(`неизвестный режим сборки: ${mode}`);

  const isLastPass = mode === 'background';

  return {
    resolve: {
      alias: { '@': resolve(root, 'src') },
    },
    build: {
      outDir,
      // `dist` очищает только первый прогон, иначе следующий снесёт предыдущий.
      emptyOutDir: mode === 'content',
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        input: { [entry.name]: resolve(root, entry.source) },
        output: {
          entryFileNames: '[name].js',
          assetFileNames: 'assets/[name][extname]',
          // Общий код обязан попасть в сам файл: чанк сломает content script.
          inlineDynamicImports: true,
        },
      },
    },
    // Проверки идут последним прогоном: к этому моменту все файлы уже собраны.
    plugins: isLastPass ? [copyManifest(), assertClassicScripts()] : [],
  };
}
