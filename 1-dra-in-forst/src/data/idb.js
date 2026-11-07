/* Liten promise-baserad IndexedDB-wrapper. */

export const DB_NAME = "bv5-tentasimulator";
export const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDb(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("exams")) db.createObjectStore("exams", { keyPath: "id" });
      if (!db.objectStoreNames.contains("questions")) {
        const s = db.createObjectStore("questions", { keyPath: "id" });
        s.createIndex("exam_id", "exam_id");
      }
      if (!db.objectStoreNames.contains("attempts")) {
        const s = db.createObjectStore("attempts", { keyPath: "id" });
        s.createIndex("started_at", "started_at");
      }
      if (!db.objectStoreNames.contains("responses")) {
        const s = db.createObjectStore("responses", { keyPath: ["attempt_id", "question_id"] });
        s.createIndex("attempt_id", "attempt_id");
        s.createIndex("question_id", "question_id");
      }
      if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "question_id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("Databasen är låst av en annan flik – stäng övriga flikar med appen."));
  });
}

export class Idb {
  constructor(db) {
    this.db = db;
  }
  static async open(name) {
    return new Idb(await openDb(name));
  }
  get(store, key) {
    return req(this.db.transaction(store).objectStore(store).get(key));
  }
  getAll(store, index, query) {
    const s = this.db.transaction(store).objectStore(store);
    return req(index ? s.index(index).getAll(query) : s.getAll(query));
  }
  count(store) {
    return req(this.db.transaction(store).objectStore(store).count());
  }
  put(store, value) {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Skrivningen avbröts"));
    });
  }
  bulkPut(store, values) {
    const tx = this.db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    for (const v of values) s.put(v);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(values.length);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Skrivningen avbröts"));
    });
  }
  delete(store, key) {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  deleteWhere(store, index, query) {
    const tx = this.db.transaction(store, "readwrite");
    const idx = tx.objectStore(store).index(index);
    const cur = idx.openKeyCursor(query);
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        tx.objectStore(store).delete(c.primaryKey);
        c.continue();
      }
    };
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  clear(store) {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  close() {
    this.db.close();
  }
}
