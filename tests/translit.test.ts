import { describe, expect, it } from 'vitest';
import { containsTranslit, sameTranslit, squash, transliterate } from '../src/core/translit';

describe('transliterate', () => {
  it('переводит кириллицу в латиницу', () => {
    expect(transliterate('король и шут')).toBe('korol i shut');
    expect(transliterate('кино')).toBe('kino');
  });

  it('сводит разные варианты транслита к одной форме', () => {
    // `kh` и `h` — самый частый разнобой в написании.
    expect(transliterate('хоzyain')).toBe(transliterate('khozyain'));
  });

  it('схлопывает y и j к i', () => {
    expect(transliterate('хозяин')).toBe('hoziain');
    expect(transliterate('khozyain')).toBe('hoziain');
  });

  it('не ломает латиницу без кириллицы', () => {
    expect(transliterate('wires')).toBe('wires');
  });

  it('убирает мягкий и твёрдый знаки', () => {
    expect(transliterate('альбом')).toBe('albom');
  });
});

describe('sameTranslit', () => {
  it('считает совпадением кириллицу и транслит', () => {
    expect(sameTranslit('король и шут', 'korol i shut')).toBe(true);
  });

  it('не считает совпадением разные имена', () => {
    expect(sameTranslit('король и шут', 'noize mc')).toBe(false);
  });

  it('пустые строки не совпадают ни с чем', () => {
    expect(sameTranslit('', '')).toBe(false);
    expect(sameTranslit('кино', '')).toBe(false);
  });
});

describe('containsTranslit', () => {
  it('находит целое внутри перечисления артистов', () => {
    expect(containsTranslit('built by titan, skybourne', 'built by titan')).toBe(true);
  });

  it('работает через границу алфавитов', () => {
    expect(containsTranslit('korol i shut', 'король и шут')).toBe(true);
  });

  it('не находит то, чего нет', () => {
    expect(containsTranslit('noize mc', 'король и шут')).toBe(false);
  });

  it('проверяет вхождение на границах слов, а не подстроку', () => {
    // Подстрока приняла бы `wiresx` за `wires` — это другое слово.
    expect(containsTranslit('wiresx', 'wires')).toBe(false);
    // А `wires ii` содержит слово `wires` целиком — для исполнителей так и надо.
    expect(containsTranslit('wires ii', 'wires')).toBe(true);
  });

  it('название защищено отдельно: `Wires II` — не `Wires`', () => {
    // Поэтому для названия используется `sameTranslit`, а не вхождение слов.
    expect(sameTranslit('wires ii', 'wires')).toBe(false);
  });
});

describe('squash', () => {
  it('оставляет только буквы и цифры', () => {
    expect(squash('Хозяин леса (Live)')).toBe('хозяинлесаlive');
  });
});