export function createMockStorage(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    async get(key: string | string[]) {
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((item) => [item, store[item]]));
      }
      return { [key]: store[key] };
    },
    async set(value: Record<string, unknown>) {
      Object.assign(store, value);
    },
    dump() {
      return { ...store };
    }
  };
}
