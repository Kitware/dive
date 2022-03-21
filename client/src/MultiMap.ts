/**
 * MultiMap maintains a mapping from identifiers to groups of other identifiers
 */
export default class MultiMap<U, V> {
  private mapping: Map<U, Set<V>>;

  constructor() {
    this.mapping = new Map();
  }

  add(key: U, value: V) {
    const set = this.mapping.get(key);
    if (set) {
      set.add(value);
    } else {
      this.mapping.set(key, new Set([value]));
    }
  }

  remove(key: U, value: V) {
    const set = this.mapping.get(key);
    if (set) {
      set.delete(value);
    }
  }

  get(key: U) {
    return this.mapping.get(key);
  }
}
