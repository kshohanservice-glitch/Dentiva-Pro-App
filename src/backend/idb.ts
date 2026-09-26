// Dentiva Pro — tiny IndexedDB kv + attachment store (browser fallback only).
// Falls back to in-memory maps under Node (tests) or when IDB is unavailable.

const memKv = new Map<string, unknown>();
const memFiles = new Map<string, { mime: string; name: string; data: Uint8Array }>();

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dentiva-pro', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    return await new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function kvGet(key: string): Promise<unknown> {
  if (!idbAvailable()) return memKv.get(key);
  try {
    return await withStore<unknown>('kv', 'readonly', (s) => s.get(key));
  } catch {
    return memKv.get(key);
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  memKv.set(key, value);
  if (!idbAvailable()) return;
  try {
    await withStore('kv', 'readwrite', (s) => s.put(value, key));
  } catch {
    /* memory fallback already set */
  }
}

export async function kvDel(key: string): Promise<void> {
  memKv.delete(key);
  if (!idbAvailable()) return;
  try {
    await withStore('kv', 'readwrite', (s) => s.delete(key));
  } catch {
    /* noop */
  }
}

export async function filePut(key: string, mime: string, name: string, data: Uint8Array): Promise<void> {
  memFiles.set(key, { mime, name, data });
  if (!idbAvailable()) return;
  try {
    await withStore('files', 'readwrite', (s) => s.put({ mime, name, data }, key));
  } catch {
    /* noop */
  }
}

export async function fileGet(key: string): Promise<{ mime: string; name: string; data: Uint8Array } | null> {
  const mem = memFiles.get(key);
  if (mem) return mem;
  if (!idbAvailable()) return null;
  try {
    const v = await withStore<{ mime: string; name: string; data: Uint8Array } | undefined>('files', 'readonly', (s) => s.get(key));
    return v ?? null;
  } catch {
    return null;
  }
}

export async function fileDel(key: string): Promise<void> {
  memFiles.delete(key);
  if (!idbAvailable()) return;
  try {
    await withStore('files', 'readwrite', (s) => s.delete(key));
  } catch {
    /* noop */
  }
}

export function memFileKeys(): string[] {
  return [...memFiles.keys()];
}
