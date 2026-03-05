import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'ingitdb-cache'
const STORE_NAME = 'entries'

const dbPromise: Promise<IDBPDatabase> = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME)
    }
  }
})

export const idbCache = {
  async get(key: string): Promise<unknown> {
    const db = await dbPromise
    return db.get(STORE_NAME, key)
  },
  async set(key: string, value: unknown): Promise<void> {
    const db = await dbPromise
    await db.put(STORE_NAME, value, key)
  },
  async delete(key: string): Promise<void> {
    const db = await dbPromise
    await db.delete(STORE_NAME, key)
  },
  async clear(): Promise<void> {
    const db = await dbPromise
    await db.clear(STORE_NAME)
  },
  async keys(): Promise<IDBValidKey[]> {
    const db = await dbPromise
    return db.getAllKeys(STORE_NAME)
  }
}
