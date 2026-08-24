// Opening an IndexedDB database without hanging.
//
// `indexedDB.open()` has a failure mode that is easy to miss and impossible to
// debug from the outside: when another connection holds an older version of the
// database open, the request fires `onblocked` and then fires **neither**
// `onsuccess` nor `onerror`. A promise wired to only those two events never
// settles, and the UI waiting on it sits on "Opening your library…" forever
// with nothing in the console.
//
// That is not hypothetical — it is what a second tab, or a reload during an
// upgrade, does. So every open here handles `onblocked`, and every open is also
// bounded by a timeout, because a promise that can hang is a bug waiting for a
// user to find it.
//
// Connections are cached per database, which also avoids most of the blocking
// in the first place: one long-lived connection cannot block itself.

const CONNECT_TIMEOUT_MS = 10_000;

const open = new Map<string, Promise<IDBDatabase>>();

export interface StoreSpec {
  name: string;
  keyPath: string;
  indexes?: readonly { name: string; keyPath: string }[];
}

/**
 * A connection to `name`, creating the stores if the database is new.
 *
 * Rejects — never hangs — when storage is unavailable, blocked by another
 * connection, or simply slow.
 */
export function openDatabase(name: string, version: number, stores: readonly StoreSpec[]): Promise<IDBDatabase> {
  const cached = open.get(name);
  if (cached) return cached;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser has no local database, so nothing can be stored on this device."));
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(
        "The local database did not open. This usually means another Ledgeur tab is open — close it and reload.",
      )));
    }, CONNECT_TIMEOUT_MS);

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, version);
    } catch (e) {
      clearTimeout(timer);
      // Safari in private browsing throws synchronously rather than erroring.
      finish(() => reject(e instanceof Error ? e : new Error(String(e))));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of stores) {
        const target = db.objectStoreNames.contains(store.name)
          ? request.transaction!.objectStore(store.name)
          : db.createObjectStore(store.name, { keyPath: store.keyPath });
        for (const index of store.indexes ?? []) {
          if (!target.indexNames.contains(index.name)) target.createIndex(index.name, index.keyPath);
        }
      }
    };

    // The event that used to strand the promise.
    request.onblocked = () => {
      clearTimeout(timer);
      finish(() => reject(new Error(
        "Another Ledgeur tab is using an older version of the local database. Close it and reload this page.",
      )));
    };

    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      // If a *later* version is opened elsewhere, this connection must let go or
      // it becomes the thing blocking somebody else.
      db.onversionchange = () => { db.close(); open.delete(name); };
      // A connection closed underneath us (storage cleared, tab evicted) must
      // not be handed out again.
      db.onclose = () => { open.delete(name); };
      finish(() => resolve(db));
    };

    request.onerror = () => {
      clearTimeout(timer);
      finish(() => reject(request.error ?? new Error("The local database could not be opened.")));
    };
  });

  // A failed connection is never cached: the cause may be transient (another
  // tab closing), and a cached rejection would keep the app broken until reload.
  promise.catch(() => open.delete(name));
  open.set(name, promise);
  return promise;
}

/** Run one request against a store, as a promise. */
export function runTransaction<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(store, mode);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    // A transaction can fail without its request erroring — a quota overrun
    // aborts the whole transaction — so both are watched.
    transaction.onabort = () => reject(transaction.error ?? new Error("The write was rolled back, usually because storage is full."));
    transaction.onerror = () => reject(transaction.error ?? new Error("The local database rejected the request."));
    const request = run(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The local database rejected the request."));
  });
}

/** Forget the cached connections. Used by tests, and after clearing storage. */
export function closeDatabases(): void {
  for (const [name, promise] of open) {
    void promise.then((db) => db.close()).catch(() => {});
    open.delete(name);
  }
}
