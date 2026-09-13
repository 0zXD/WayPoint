import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';

export const idbPersister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => {
      const value = await get(key);
      return value as string | null;
    },
    setItem: async (key, value) => {
      await set(key, value);
    },
    removeItem: async (key) => {
      await del(key);
    },
  },
});
