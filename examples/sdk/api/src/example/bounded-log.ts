// Example plumbing: an in-memory log, newest first, that keeps the last `limit` entries and tells listeners about new
// ones. The request log and the received-webhooks log are two of them; a restart clears both.

export class BoundedLog<T extends { id: string }> {
  readonly #limit: number;
  /** Newest first. */
  #entries: T[] = [];
  readonly #byId = new Map<string, T>();
  readonly #listeners = new Set<(entry: T) => void>();

  constructor(limit: number) {
    this.#limit = limit;
  }

  add(entry: T): void {
    this.#entries.unshift(entry);
    this.#byId.set(entry.id, entry);
    for (const dropped of this.#entries.splice(this.#limit)) this.#byId.delete(dropped.id);
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

  /** The entries matching `filter`, newest first, one page of them and the total. */
  page(filter: (entry: T) => boolean, page: number, limit: number): { items: T[]; total: number } {
    const matching = this.#entries.filter(filter);
    return { items: matching.slice((page - 1) * limit, page * limit), total: matching.length };
  }

  clear(): void {
    this.#entries = [];
    this.#byId.clear();
  }

  /** Calls `listener` with every new entry; returns the unsubscribe function. */
  subscribe(listener: (entry: T) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
