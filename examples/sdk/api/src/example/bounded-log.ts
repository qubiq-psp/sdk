// Example plumbing: an in-memory log, newest first, that keeps the last `limit` entries and at most `maxBytes` of
// them, and tells listeners about new ones. The request log and the received-webhooks log are built of them; a
// restart clears both.

/** The size an entry is counted with: the UTF-8 bytes of its JSON — close to what it holds in memory. */
export const jsonBytes = (entry: unknown): number => Buffer.byteLength(JSON.stringify(entry), 'utf8');

/** 1, 2, 3, … — the arrival order of entries, shared by logs that are listed together. */
export function counter(): () => number {
  let n = 0;
  return () => ++n;
}

interface Kept<T> {
  entry: T;
  bytes: number;
  seq: number;
}

export class BoundedLog<T extends { id: string }> {
  readonly #limit: number;
  readonly #maxBytes: number;
  readonly #seq: () => number;
  /** Newest first. */
  #entries: Kept<T>[] = [];
  readonly #byId = new Map<string, T>();
  #bytes = 0;
  readonly #listeners = new Set<(entry: T) => void>();

  /**
   * @param maxBytes bytes of all entries, counted by {@link jsonBytes}; the newest entry always stays
   * @param seq where arrival numbers come from: logs that share one are merged by arrival ({@link mergedEntries})
   */
  constructor(limit: number, maxBytes = Number.POSITIVE_INFINITY, seq: () => number = counter()) {
    this.#limit = limit;
    this.#maxBytes = maxBytes;
    this.#seq = seq;
  }

  add(entry: T): void {
    const bytes = jsonBytes(entry);
    this.#entries.unshift({ entry, bytes, seq: this.#seq() });
    this.#byId.set(entry.id, entry);
    this.#bytes += bytes;
    while (this.#entries.length > 1 && (this.#entries.length > this.#limit || this.#bytes > this.#maxBytes)) {
      const dropped = this.#entries.pop();
      if (dropped === undefined) break;
      this.#byId.delete(dropped.entry.id);
      this.#bytes -= dropped.bytes;
    }
    for (const listener of this.#listeners) {
      try {
        listener(entry);
      } catch {
        // a broken subscriber (e.g. a closed SSE connection) must not break the log
      }
    }
  }

  get(id: string): T | undefined {
    return this.#byId.get(id);
  }

  /** The entries with their arrival numbers, newest first. */
  kept(): readonly Kept<T>[] {
    return this.#entries;
  }

  /** The entries matching `filter`, newest first, one page of them and the total. */
  page(filter: (entry: T) => boolean, page: number, limit: number): { items: T[]; total: number } {
    return pageOf(
      this.#entries.map((kept) => kept.entry),
      filter,
      page,
      limit,
    );
  }

  clear(): void {
    this.#entries = [];
    this.#byId.clear();
    this.#bytes = 0;
  }

  /** Calls `listener` with every new entry; returns the unsubscribe function. */
  subscribe(listener: (entry: T) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** The entries of several logs sharing one `seq`, newest first. */
export function mergedEntries<T extends { id: string }>(...logs: BoundedLog<T>[]): T[] {
  return logs
    .flatMap((log) => log.kept())
    .sort((a, b) => b.seq - a.seq)
    .map((kept) => kept.entry);
}

/** One page of `entries` (newest first) matching `filter`, and the total. */
export function pageOf<T>(
  entries: readonly T[],
  filter: (entry: T) => boolean,
  page: number,
  limit: number,
): { items: T[]; total: number } {
  const matching = entries.filter(filter);
  return { items: matching.slice((page - 1) * limit, page * limit), total: matching.length };
}
