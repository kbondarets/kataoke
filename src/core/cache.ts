/**
 * Хранилище кеша.
 *
 * В расширении это `chrome.storage.local`, в тестах — память. Интерфейс
 * минимальный, чтобы движок и провайдер не зависели от конкретного хранилища.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Кеш в памяти — для тестов и для окружения без `chrome.storage`. */
export class MemoryCacheStore implements CacheStore {
  readonly #values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    const value = this.#values.get(key);
    return value === undefined ? null : (value as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.#values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.#values.delete(key);
  }

  /** Размер кеша — только для тестов и диагностики. */
  get size(): number {
    return this.#values.size;
  }
}

/** Запись в кеше: когда положена и до когда годится. */
export interface CacheEntry<T> {
  value: T;
  /** Время записи, миллисекунды Unix. */
  savedAtMs: number;
  /** Время истечения, миллисекунды Unix; `null` — не истекает. */
  expiresAtMs: number | null;
}

/** Кеш с временем жизни и схемой: смена схемы сбрасывает старые записи. */
export class TtlCache {
  constructor(
    private readonly store: CacheStore,
    private readonly schemaVersion: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const entry = await this.store.get<CacheEntry<T>>(this.#key(key));
    if (!entry) return null;

    if (entry.expiresAtMs !== null && entry.expiresAtMs <= this.now()) {
      await this.store.remove(this.#key(key));
      return null;
    }

    return entry.value;
  }

  async set<T>(key: string, value: T, ttlMs: number | null): Promise<void> {
    const nowMs = this.now();
    const entry: CacheEntry<T> = {
      value,
      savedAtMs: nowMs,
      expiresAtMs: ttlMs === null ? null : nowMs + ttlMs,
    };
    await this.store.set(this.#key(key), entry);
  }

  async remove(key: string): Promise<void> {
    await this.store.remove(this.#key(key));
  }

  // Версия схемы в префиксе: при изменении формата текста старые записи просто
  // перестают находиться и не могут сломать парсер.
  #key(key: string): string {
    return `v${this.schemaVersion}:${key}`;
  }
}

/** Время жизни положительного результата: по сути бессрочно. */
export const POSITIVE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Время жизни отрицательного результата: короче, текст может появиться позже. */
export const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
