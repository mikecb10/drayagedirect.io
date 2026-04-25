// lib/driver-app/offline-queue.js
/**
 * IndexedDB-backed FIFO queue for offline pings + queued actions.
 * Cap 100 entries; oldest dropped on overflow. Drains via the batch endpoint
 * on `online` event.
 */

const DB_NAME = 'dd_driver_app';
const DB_VERSION = 1;
const STORE = 'pendingPings';
const MAX_QUEUE = 100;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function enqueue(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.add({ ...item, createdAt: Date.now() });
    req.onsuccess = async () => {
      // Cap enforcement: count, drop oldest if over.
      const count = await new Promise((r) => {
        const c = store.count();
        c.onsuccess = () => r(c.result);
      });
      if (count > MAX_QUEUE) {
        const cursor = store.openCursor();
        cursor.onsuccess = (e) => {
          const cur = e.target.result;
          if (cur) cur.delete();
        };
      }
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function drainAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const items = [];
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) {
        items.push(cur.value);
        cur.continue();
      }
    };
    tx.oncomplete = () => resolve(items);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function flushToServer({ driverFetch }) {
  const items = await drainAll();
  if (items.length === 0) return { flushed: 0 };
  // Only ping items in v1 — actions are not queued (driver gets immediate
  // feedback in the UI and can re-tap if offline).
  const pingItems = items
    .filter((i) => i.type === 'ping')
    .map((i) => ({ moveId: i.payload.moveId, gpsPing: i.payload.gpsPing }));
  if (pingItems.length === 0) return { flushed: 0 };
  const res = await driverFetch('/api/driver/pings/batch', {
    method: 'POST',
    body: JSON.stringify({ items: pingItems }),
  });
  if (res.ok) {
    await clearAll();
    return { flushed: pingItems.length };
  }
  return { flushed: 0, error: res.status };
}
