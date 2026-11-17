/** The size an entry is counted with: the UTF-8 bytes of its JSON — close to what it holds in memory. */
export const jsonBytes = (item: unknown): number => Buffer.byteLength(JSON.stringify(item), 'utf8');

/**
 * Entries in memory, newest first, at most `limit` of them and at most `maxBytes` in total (counted by
 * {@link jsonBytes}): the oldest go when a new one comes. The newest entry always stays. A restart clears them.
 */
export class MemoryLog<T extends { id: string }> {
  readonly #limit: number;
  readonly #maxBytes: number;
  #items: { item: T; bytes: number; seq: number }[] = [];
  readonly #byId = new Map<string, T>();
  #bytes = 0;
  readonly #seq: () => number;

  /**
   * @param seq where the arrival numbers come from: two logs that share one are merged by arrival (the received
   *   webhooks keep verified and unverified requests apart, but list them together)
   */
  constructor(limit: number, maxBytes = Number.POSITIVE_INFINITY, seq: () => number = counter()) {
    this.#limit = limit;
    this.#maxBytes = maxBytes;
    this.#seq = seq;
  }

  add(item: T): void {
    const bytes = jsonBytes(item);
    this.#items.unshift({ item, bytes, seq: this.#seq() });
    this.#byId.set(item.id, item);
    this.#bytes += bytes;
    while (this.#items.length > 1 && (this.#items.length > this.#limit || this.#bytes > this.#maxBytes)) {
      const dropped = this.#items.pop();
      if (!dropped) break;
      this.#byId.delete(dropped.item.id);
      this.#bytes -= dropped.bytes;
    }
  }

  get(id: string): T | undefined {
    return this.#byId.get(id);
  }

  /** The entries with their arrival number (larger is newer), newest first. */
  entries(): readonly { item: T; seq: number }[] {
    return this.#items;
  }

  /** The bytes the entries are counted with. */
  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#items.length;
  }

  /** One page of the entries that pass `filter`, newest first. */
  page(filter: (item: T) => boolean, page: number, limit: number): { items: T[]; total: number } {
    return pageOf(
      this.#items.map((e) => e.item),
      filter,
      page,
      limit,
    );
  }

  clear(): void {
    this.#items = [];
    this.#byId.clear();
    this.#bytes = 0;
  }
}

/** 1, 2, 3, … */
export function counter(): () => number {
  let n = 0;
  return () => ++n;
}

/** The entries of several logs in one list, newest first. */
export function merged<T extends { id: string }>(...logs: MemoryLog<T>[]): T[] {
  return logs
    .flatMap((log) => log.entries())
    .sort((a, b) => b.seq - a.seq)
    .map((e) => e.item);
}

/** One page of `items` (newest first) that pass `filter`, and how many pass. */
export function pageOf<T>(
  items: readonly T[],
  filter: (item: T) => boolean,
  page: number,
  limit: number,
): { items: T[]; total: number } {
  const matching = items.filter(filter);
  return { items: matching.slice((page - 1) * limit, page * limit), total: matching.length };
}
