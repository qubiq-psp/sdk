/** Entries in memory, newest first, at most `limit`: the oldest go when a new one comes. A restart clears them. */
export class MemoryLog<T extends { id: string }> {
  readonly #limit: number;
  #items: T[] = [];
  readonly #byId = new Map<string, T>();

  constructor(limit: number) {
    this.#limit = limit;
  }

  add(item: T): void {
    this.#items.unshift(item);
    this.#byId.set(item.id, item);
    while (this.#items.length > this.#limit) {
      const dropped = this.#items.pop();
      if (dropped) this.#byId.delete(dropped.id);
    }
  }

  get(id: string): T | undefined {
    return this.#byId.get(id);
  }

  /** One page of the entries that pass `filter`, newest first. */
  page(filter: (item: T) => boolean, page: number, limit: number): { items: T[]; total: number } {
    const matching = this.#items.filter(filter);
    return { items: matching.slice((page - 1) * limit, page * limit), total: matching.length };
  }

  clear(): void {
    this.#items = [];
    this.#byId.clear();
  }
}
